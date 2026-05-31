//! 持久化存储
//! 
//! 支持 SQLite 和向量数据库

use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use serde::{Serialize, Deserialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::{MemoryEntry, MemoryTier, MemoryType, MemoryError};

/// 持久化配置
#[derive(Debug, Clone)]
pub struct PersistenceConfig {
    /// SQLite 数据库路径
    pub sqlite_path: PathBuf,
    /// 向量数据库路径
    pub vector_db_path: PathBuf,
    /// 自动保存间隔（秒）
    pub auto_save_interval_secs: u64,
    /// 是否启用 WAL 模式
    pub enable_wal: bool,
    /// 最大批量大小
    pub batch_size: usize,
}

impl Default for PersistenceConfig {
    fn default() -> Self {
        let data_dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("openoxygen");
        
        Self {
            sqlite_path: data_dir.join("memory.db"),
            vector_db_path: data_dir.join("vectors"),
            auto_save_interval_secs: 60,
            enable_wal: true,
            batch_size: 100,
        }
    }
}

/// 持久化存储
pub struct PersistenceStore {
    config: PersistenceConfig,
    sqlite: Arc<RwLock<rusqlite::Connection>>,
    vector_store: Arc<RwLock<VectorStore>>,
    dirty_entries: Arc<RwLock<Vec<String>>>,
}

/// 向量存储
pub struct VectorStore {
    /// 向量维度
    dim: usize,
    /// 内存中的向量
    vectors: std::collections::HashMap<String, Vec<f32>>,
    /// 索引（简化版：使用倒排索引）
    index: std::collections::HashMap<String, Vec<String>>,
}

impl VectorStore {
    pub fn new(dim: usize) -> Result<Self, MemoryError> {
        Ok(Self {
            dim,
            vectors: std::collections::HashMap::new(),
            index: std::collections::HashMap::new(),
        })
    }

    /// 插入向量
    pub fn insert(&mut self, id: String, vector: Vec<f32>) -> Result<(), MemoryError> {
        if vector.len() != self.dim {
            return Err(MemoryError::StorageError(format!(
                "Vector dimension mismatch: expected {}, got {}",
                self.dim, vector.len()
            )));
        }

        self.vectors.insert(id.clone(), vector);
        
        // 更新索引（简单分桶）
        // 实际应使用更复杂的索引如 HNSW
        Ok(())
    }

    /// 搜索相似向量
    pub fn search(&self, query: &[f32], top_k: usize) -> Vec<(String, f32)> {
        let mut results: Vec<(String, f32)> = self
            .vectors
            .iter()
            .map(|(id, vec)| {
                let similarity = cosine_similarity(query, vec);
                (id.clone(), similarity)
            })
            .collect();

        results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        results.into_iter().take(top_k).collect()
    }

    /// 删除向量
    pub fn delete(&mut self, id: &str) {
        self.vectors.remove(id);
    }

    /// 加载
    pub fn load(&mut self, path: &PathBuf) -> Result<(), MemoryError> {
        // 从文件加载
        if let Ok(data) = std::fs::read_to_string(path) {
            // 解析保存的向量
            // 格式: JSON 或二进制
            for line in data.lines() {
                if let Ok((id, vec)) = parse_vector_line(line) {
                    self.vectors.insert(id, vec);
                }
            }
        }
        Ok(())
    }

    /// 保存
    pub fn save(&self, path: &PathBuf) -> Result<(), MemoryError> {
        let mut lines = Vec::new();
        for (id, vec) in &self.vectors {
            let line = format_vector_line(id, vec);
            lines.push(line);
        }
        
        std::fs::write(path, lines.join("\n"))
            .map_err(|e| MemoryError::StorageError(e.to_string()))?;
        
        Ok(())
    }
}

/// 余弦相似度
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    dot / (norm_a * norm_b + 1e-8)
}

/// 解析向量行
fn parse_vector_line(line: &str) -> Result<(String, Vec<f32>), MemoryError> {
    let parts: Vec<&str> = line.splitn(2, '|').collect();
    if parts.len() != 2 {
        return Err(MemoryError::StorageError("Invalid vector line format".to_string()));
    }
    
    let id = parts[0].to_string();
    let values: Vec<f32> = parts[1]
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .collect();
    
    Ok((id, values))
}

/// 格式化向量行
fn format_vector_line(id: &str, vec: &[f32]) -> String {
    let values = vec.iter()
        .map(|v| format!("{:.6}", v))
        .collect::<Vec<_>>()
        .join(",");
    format!("{}|{}", id, values)
}

impl PersistenceStore {
    /// 创建新的持久化存储
    pub async fn new(config: PersistenceConfig) -> Result<Self, MemoryError> {
        // 确保数据目录存在
        if let Some(parent) = config.sqlite_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| MemoryError::StorageError(e.to_string()))?;
        }

        // 打开 SQLite 连接
        let sqlite = rusqlite::Connection::open(&config.sqlite_path)
            .map_err(|e| MemoryError::StorageError(format!("SQLite error: {}", e)))?;

        // 启用 WAL 模式
        if config.enable_wal {
            sqlite.pragma_update(None, "journal_mode", "WAL")
                .map_err(|e| MemoryError::StorageError(e.to_string()))?;
        }

        // 初始化表
        sqlite.execute_batch("
            CREATE TABLE IF NOT EXISTS memory_entries (
                id TEXT PRIMARY KEY,
                tier TEXT NOT NULL,
                memory_type TEXT NOT NULL,
                content TEXT NOT NULL,
                metadata TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                access_count INTEGER DEFAULT 0,
                importance_score REAL DEFAULT 0.0,
                decay_factor REAL DEFAULT 1.0,
                related_entries TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_tier ON memory_entries(tier);
            CREATE INDEX IF NOT EXISTS idx_created_at ON memory_entries(created_at);
            CREATE INDEX IF NOT EXISTS idx_importance ON memory_entries(importance_score);
            CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id, content);
        ").map_err(|e| MemoryError::StorageError(e.to_string()))?;

        // 加载向量存储
        let mut vector_store = VectorStore::new(1536)?;
        let _ = vector_store.load(&config.vector_db_path); // 忽略错误

        let store = Self {
            config,
            sqlite: Arc::new(RwLock::new(sqlite)),
            vector_store: Arc::new(RwLock::new(vector_store)),
            dirty_entries: Arc::new(RwLock::new(Vec::new())),
        };

        // 启动自动保存
        store.start_auto_save().await;

        Ok(store)
    }

    /// 保存记忆条目
    pub async fn save_entry(&self, entry: &MemoryEntry) -> Result<(), MemoryError> {
        let sqlite = self.sqlite.write().await;

        sqlite.execute(
            "INSERT OR REPLACE INTO memory_entries (
                id, tier, memory_type, content, metadata,
                created_at, updated_at, access_count,
                importance_score, decay_factor, related_entries
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                entry.id,
                format!("{:?}", entry.tier),
                format!("{:?}", entry.memory_type),
                entry.content,
                serde_json::to_string(&entry.metadata).unwrap_or_default(),
                entry.created_at.to_rfc3339(),
                entry.updated_at.to_rfc3339(),
                entry.access_count,
                entry.importance_score,
                entry.decay_factor,
                entry.related_entries.join(","),
            ],
        ).map_err(|e| MemoryError::StorageError(e.to_string()))?;

        // 更新 FTS
        sqlite.execute(
            "INSERT OR REPLACE INTO memory_fts (id, content) VALUES (?1, ?2)",
            [&entry.id, &entry.content],
        ).map_err(|e| MemoryError::StorageError(e.to_string()))?;

        // 保存向量
        if let Some(ref embedding) = entry.embedding {
            self.vector_store.write().await
                .insert(entry.id.clone(), embedding.clone())?;
        }

        // 标记为脏
        self.dirty_entries.write().await.push(entry.id.clone());

        Ok(())
    }

    /// 批量保存
    pub async fn save_batch(&self, entries: &[MemoryEntry]) -> Result<(), MemoryError> {
        let mut sqlite = self.sqlite.write().await;
        
        let tx = sqlite.transaction()
            .map_err(|e| MemoryError::StorageError(e.to_string()))?;

        for entry in entries {
            tx.execute(
                "INSERT OR REPLACE INTO memory_entries (
                    id, tier, memory_type, content, metadata,
                    created_at, updated_at, access_count,
                    importance_score, decay_factor, related_entries
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                rusqlite::params![
                    entry.id,
                    format!("{:?}", entry.tier),
                    format!("{:?}", entry.memory_type),
                    entry.content,
                    serde_json::to_string(&entry.metadata).unwrap_or_default(),
                    entry.created_at.to_rfc3339(),
                    entry.updated_at.to_rfc3339(),
                    entry.access_count,
                    entry.importance_score,
                    entry.decay_factor,
                    entry.related_entries.join(","),
                ],
            ).map_err(|e| MemoryError::StorageError(e.to_string()))?;
        }

        tx.commit().map_err(|e| MemoryError::StorageError(e.to_string()))?;

        // 批量保存向量
        {
            let mut vector_store = self.vector_store.write().await;
            for entry in entries {
                if let Some(ref embedding) = entry.embedding {
                    vector_store.insert(entry.id.clone(), embedding.clone())?;
                }
            }
        }

        Ok(())
    }

    /// 加载记忆条目
    pub async fn load_entry(&self, id: &str) -> Result<Option<MemoryEntry>, MemoryError> {
        let sqlite = self.sqlite.read().await;

        let mut stmt = sqlite.prepare(
            "SELECT * FROM memory_entries WHERE id = ?1"
        ).map_err(|e| MemoryError::StorageError(e.to_string()))?;

        let entry = stmt.query_row(
            [id],
            |row| {
                let tier_str: String = row.get(1)?;
                let type_str: String = row.get(2)?;
                let metadata_str: String = row.get(4)?;
                let created_str: String = row.get(5)?;
                let updated_str: String = row.get(6)?;
                let related_str: String = row.get(10)?;

                Ok(MemoryEntry {
                    id: row.get(0)?,
                    tier: parse_tier(&tier_str),
                    memory_type: parse_type(&type_str),
                    content: row.get(3)?,
                    embedding: None, // 从向量存储加载
                    metadata: serde_json::from_str(&metadata_str).unwrap_or_default(),
                    created_at: DateTime::parse_from_rfc3339(&created_str)
                        .unwrap_or_default()
                        .with_timezone(&Utc),
                    updated_at: DateTime::parse_from_rfc3339(&updated_str)
                        .unwrap_or_default()
                        .with_timezone(&Utc),
                    access_count: row.get(7)?,
                    importance_score: row.get(8)?,
                    decay_factor: row.get(9)?,
                    related_entries: related_str.split(',').map(|s| s.to_string()).collect(),
                    context_snapshot: None,
                })
            },
        ).ok();

        // 如果找到，加载向量
        if let Some(ref mut entry) = entry {
            let vector_store = self.vector_store.read().await;
            if let Some(vec) = vector_store.vectors.get(id) {
                entry.embedding = Some(vec.clone());
            }
        }

        Ok(entry)
    }

    /// 搜索记忆
    pub async fn search(
        &self,
        query: &str,
        tier: Option<MemoryTier>,
        limit: usize,
    ) -> Result<Vec<MemoryEntry>, MemoryError> {
        let sqlite = self.sqlite.read().await;

        // FTS 搜索
        let sql = if tier.is_some() {
            "SELECT e.* FROM memory_entries e
             JOIN memory_fts fts ON e.id = fts.id
             WHERE fts.content MATCH ?1 AND e.tier = ?2
             ORDER BY rank
             LIMIT ?3"
        } else {
            "SELECT e.* FROM memory_entries e
             JOIN memory_fts fts ON e.id = fts.id
             WHERE fts.content MATCH ?1
             ORDER BY rank
             LIMIT ?3"
        };

        let mut stmt = sqlite.prepare(sql)
            .map_err(|e| MemoryError::StorageError(e.to_string()))?;

        let params: Vec<&dyn rusqlite::ToSql> = if let Some(t) = tier {
            vec![&query, &format!("{:?}", t), &(limit as i64)]
        } else {
            vec![&query, &(limit as i64)]
        };

        let entries: Vec<MemoryEntry> = stmt
            .query_map(&params[..], |row| {
                parse_row(row)
            })
            .map_err(|e| MemoryError::StorageError(e.to_string()))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(entries)
    }

    /// 向量搜索
    pub async fn vector_search(
        &self,
        query_embedding: &[f32],
        top_k: usize,
    ) -> Result<Vec<(String, f32)>, MemoryError> {
        let vector_store = self.vector_store.read().await;
        Ok(vector_store.search(query_embedding, top_k))
    }

    /// 删除记忆
    pub async fn delete_entry(&self, id: &str) -> Result<(), MemoryError> {
        let sqlite = self.sqlite.write().await;

        sqlite.execute("DELETE FROM memory_entries WHERE id = ?1", [id])
            .map_err(|e| MemoryError::StorageError(e.to_string()))?;

        sqlite.execute("DELETE FROM memory_fts WHERE id = ?1", [id])
            .map_err(|e| MemoryError::StorageError(e.to_string()))?;

        self.vector_store.write().await.delete(id);

        Ok(())
    }

    /// 按层级加载
    pub async fn load_by_tier(
        &self,
        tier: MemoryTier,
        limit: usize,
    ) -> Result<Vec<MemoryEntry>, MemoryError> {
        let sqlite = self.sqlite.read().await;

        let mut stmt = sqlite.prepare(
            "SELECT * FROM memory_entries WHERE tier = ?1 ORDER BY created_at DESC LIMIT ?2"
        ).map_err(|e| MemoryError::StorageError(e.to_string()))?;

        let entries: Vec<MemoryEntry> = stmt
            .query_map(
                [format!("{:?}", tier), limit.to_string()],
                |row| parse_row(row),
            )
            .map_err(|e| MemoryError::StorageError(e.to_string()))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(entries)
    }

    /// 获取统计
    pub async fn stats(&self) -> Result<PersistenceStats, MemoryError> {
        let sqlite = self.sqlite.read().await;

        let total: i64 = sqlite.query_row(
            "SELECT COUNT(*) FROM memory_entries",
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        let by_tier: std::collections::HashMap<String, i64> = sqlite.prepare(
            "SELECT tier, COUNT(*) FROM memory_entries GROUP BY tier"
        )?.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?.filter_map(|r| r.ok()).collect();

        Ok(PersistenceStats {
            total_entries: total as usize,
            by_tier,
        })
    }

    /// 清理旧条目
    pub async fn cleanup_old(
        &self,
        before: DateTime<Utc>,
        tier: Option<MemoryTier>,
    ) -> Result<usize, MemoryError> {
        let sqlite = self.sqlite.write().await;

        let deleted = if let Some(t) = tier {
            sqlite.execute(
                "DELETE FROM memory_entries WHERE created_at < ?1 AND tier = ?2",
                [before.to_rfc3339(), format!("{:?}", t)],
            )?
        } else {
            sqlite.execute(
                "DELETE FROM memory_entries WHERE created_at < ?1",
                [before.to_rfc3339()],
            )?
        };

        Ok(deleted)
    }

    /// 启动自动保存
    async fn start_auto_save(&self) {
        let interval = tokio::time::Duration::from_secs(self.config.auto_save_interval_secs);
        let vector_store = self.vector_store.clone();
        let path = self.config.vector_db_path.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(interval);
            loop {
                interval.tick().await;
                
                if let Err(e) = vector_store.read().await.save(&path) {
                    eprintln!("Auto-save failed: {}", e);
                }
            }
        });
    }

    /// 手动保存所有
    pub async fn flush(&self) -> Result<(), MemoryError> {
        let vector_store = self.vector_store.read().await;
        vector_store.save(&self.config.vector_db_path)?;
        
        self.dirty_entries.write().await.clear();
        
        Ok(())
    }
}

/// 解析层级
fn parse_tier(s: &str) -> MemoryTier {
    match s {
        "ShortTerm" => MemoryTier::ShortTerm,
        "MediumTerm" => MemoryTier::MediumTerm,
        "LongTerm" => MemoryTier::LongTerm,
        _ => MemoryTier::ShortTerm,
    }
}

/// 解析类型
fn parse_type(s: &str) -> MemoryType {
    match s {
        "UserInput" => MemoryType::UserInput,
        "SystemResponse" => MemoryType::SystemResponse,
        "Action" => MemoryType::Action,
        "Error" => MemoryType::Error,
        "Reflection" => MemoryType::Reflection,
        "FileReference" => MemoryType::FileReference,
        "EnvironmentState" => MemoryType::EnvironmentState,
        _ => MemoryType::UserInput,
    }
}

/// 解析行
fn parse_row(row: &rusqlite::Row) -> Result<MemoryEntry, rusqlite::Error> {
    let tier_str: String = row.get(1)?;
    let type_str: String = row.get(2)?;
    let metadata_str: String = row.get(4)?;
    let created_str: String = row.get(5)?;
    let updated_str: String = row.get(6)?;
    let related_str: String = row.get(10)?;

    Ok(MemoryEntry {
        id: row.get(0)?,
        tier: parse_tier(&tier_str),
        memory_type: parse_type(&type_str),
        content: row.get(3)?,
        embedding: None,
        metadata: serde_json::from_str(&metadata_str).unwrap_or_default(),
        created_at: DateTime::parse_from_rfc3339(&created_str)
            .unwrap_or_default()
            .with_timezone(&Utc),
        updated_at: DateTime::parse_from_rfc3339(&updated_str)
            .unwrap_or_default()
            .with_timezone(&Utc),
        access_count: row.get(7)?,
        importance_score: row.get(8)?,
        decay_factor: row.get(9)?,
        related_entries: related_str.split(',').map(|s| s.to_string()).collect(),
        context_snapshot: None,
    })
}

/// 持久化统计
#[derive(Debug)]
pub struct PersistenceStats {
    pub total_entries: usize,
    pub by_tier: std::collections::HashMap<String, i64>,
}
