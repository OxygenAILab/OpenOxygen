//! OpenOxygen Next - Hierarchical Memory System
//! 
//! 分层记忆系统：短期 / 中期 / 长期
//! 支持语义嵌入、向量检索、时间衰减

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc, Duration};
use uuid::Uuid;

pub mod embeddings;
pub mod vector_store;
pub mod decay;

/// 记忆层级
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryTier {
    /// 短期记忆 - 当前会话，容量有限，快速衰减
    ShortTerm,
    /// 中期记忆 - 跨会话，按重要性保留
    MediumTerm,
    /// 长期记忆 - 持久化，需显式归档
    LongTerm,
}

/// 记忆类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryType {
    /// 用户输入
    UserInput,
    /// 系统响应
    SystemResponse,
    /// 操作执行
    Action,
    /// 错误/异常
    Error,
    /// 反思结果
    Reflection,
    /// 文件引用
    FileReference,
    /// 环境状态
    EnvironmentState,
}

/// 记忆项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub id: String,
    pub tier: MemoryTier,
    pub memory_type: MemoryType,
    pub content: String,
    pub embedding: Option<Vec<f32>>,
    pub metadata: MemoryMetadata,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub access_count: u32,
    pub importance_score: f32, // 0.0 - 1.0
    pub decay_factor: f32,     // 衰减系数
    pub related_entries: Vec<String>, // 关联记忆ID
    pub context_snapshot: Option<serde_json::Value>,
}

/// 记忆元数据
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MemoryMetadata {
    pub session_id: Option<String>,
    pub task_id: Option<String>,
    pub agent_id: Option<String>,
    pub source: Option<String>,
    pub tags: Vec<String>,
    pub custom: HashMap<String, serde_json::Value>,
}

/// 记忆查询
#[derive(Debug, Clone, Default)]
pub struct MemoryQuery {
    pub content: Option<String>,
    pub tier: Option<MemoryTier>,
    pub memory_type: Option<MemoryType>,
    pub session_id: Option<String>,
    pub task_id: Option<String>,
    pub time_range: Option<(DateTime<Utc>, DateTime<Utc>)>,
    pub tags: Vec<String>,
    pub semantic_query: Option<String>,
    pub top_k: usize,
    pub min_importance: f32,
}

/// 记忆存储
#[derive(Debug, Clone)]
pub struct MemoryStore {
    short_term: Arc<RwLock<Vec<MemoryEntry>>>,
    medium_term: Arc<RwLock<Vec<MemoryEntry>>>,
    long_term: Arc<RwLock<Vec<MemoryEntry>>>,
    vector_store: vector_store::VectorStore,
    config: MemoryConfig,
}

/// 记忆配置
#[derive(Debug, Clone)]
pub struct MemoryConfig {
    /// 短期记忆最大容量
    pub short_term_capacity: usize,
    /// 中期记忆最大容量
    pub medium_term_capacity: usize,
    /// 长期记忆最大容量（0 = 无限制）
    pub long_term_capacity: usize,
    /// 短期记忆保留时间（分钟）
    pub short_term_retention_minutes: i64,
    /// 中期记忆保留时间（小时）
    pub medium_term_retention_hours: i64,
    /// 嵌入向量维度
    pub embedding_dim: usize,
    /// 默认 Top-K 检索
    pub default_top_k: usize,
    /// 相似度阈值
    pub similarity_threshold: f32,
}

impl Default for MemoryConfig {
    fn default() -> Self {
        Self {
            short_term_capacity: 100,
            medium_term_capacity: 1000,
            long_term_capacity: 0, // 无限制
            short_term_retention_minutes: 30,
            medium_term_retention_hours: 24,
            embedding_dim: 1536,
            default_top_k: 10,
            similarity_threshold: 0.7,
        }
    }
}

impl MemoryStore {
    /// 创建新的记忆存储
    pub async fn new(config: MemoryConfig) -> Result<Self, MemoryError> {
        Ok(Self {
            short_term: Arc::new(RwLock::new(Vec::with_capacity(config.short_term_capacity))),
            medium_term: Arc::new(RwLock::new(Vec::with_capacity(config.medium_term_capacity))),
            long_term: Arc::new(RwLock::new(Vec::new())),
            vector_store: vector_store::VectorStore::new(config.embedding_dim).await?,
            config,
        })
    }

    /// 存储记忆
    pub async fn store(
        &self,
        content: impl Into<String>,
        tier: MemoryTier,
        memory_type: MemoryType,
        importance: f32,
        metadata: MemoryMetadata,
    ) -> Result<MemoryEntry, MemoryError> {
        let content_str = content.into();
        let id = Uuid::new_v4().to_string();
        
        // 生成嵌入向量
        let embedding = embeddings::generate_embedding(&content_str).await.ok();
        
        let entry = MemoryEntry {
            id: id.clone(),
            tier,
            memory_type,
            content: content_str.clone(),
            embedding: embedding.clone(),
            metadata,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            access_count: 0,
            importance_score: importance.clamp(0.0, 1.0),
            decay_factor: self.calculate_decay_factor(tier, importance),
            related_entries: vec![],
            context_snapshot: None,
        };

        // 存储到对应层级
        match tier {
            MemoryTier::ShortTerm => {
                let mut store = self.short_term.write().await;
                self.maintain_capacity(&mut store, self.config.short_term_capacity).await?;
                store.push(entry.clone());
            }
            MemoryTier::MediumTerm => {
                let mut store = self.medium_term.write().await;
                self.maintain_capacity(&mut store, self.config.medium_term_capacity).await?;
                store.push(entry.clone());
            }
            MemoryTier::LongTerm => {
                let mut store = self.long_term.write().await;
                if self.config.long_term_capacity > 0 {
                    self.maintain_capacity(&mut store, self.config.long_term_capacity).await?;
                }
                store.push(entry.clone());
            }
        }

        // 存储到向量库
        if let Some(emb) = embedding {
            self.vector_store.insert(id, emb, tier).await?;
        }

        Ok(entry)
    }

    /// 检索记忆
    pub async fn retrieve(&self, query: MemoryQuery) -> Result<Vec<MemoryEntry>, MemoryError> {
        let mut results = Vec::new();

        // 语义检索
        if let Some(semantic) = &query.semantic_query {
            let query_embedding = embeddings::generate_embedding(semantic).await?;
            let semantic_results = self.vector_store
                .search(&query_embedding, query.top_k, query.tier)
                .await?;
            
            // 从各层级获取完整记忆
            for (id, score) in semantic_results {
                if score < self.config.similarity_threshold {
                    continue;
                }
                if let Some(entry) = self.get_by_id(&id).await {
                    if entry.importance_score >= query.min_importance {
                        results.push(entry);
                    }
                }
            }
        }

        // 关键词检索
        if let Some(content) = &query.content {
            let keyword_results = self.keyword_search(content, query.tier).await?;
            results.extend(keyword_results);
        }

        // 过滤和排序
        results = self.filter_and_rank(results, &query).await;

        // 更新访问计数
        for entry in &mut results {
            self.increment_access_count(&entry.id).await?;
        }

        Ok(results.into_iter().take(query.top_k).collect())
    }

    /// 按 ID 获取
    async fn get_by_id(&self, id: &str) -> Option<MemoryEntry> {
        // 检查短期记忆
        let short = self.short_term.read().await;
        if let Some(entry) = short.iter().find(|e| e.id == id) {
            return Some(entry.clone());
        }
        drop(short);

        // 检查中期记忆
        let medium = self.medium_term.read().await;
        if let Some(entry) = medium.iter().find(|e| e.id == id) {
            return Some(entry.clone());
        }
        drop(medium);

        // 检查长期记忆
        let long = self.long_term.read().await;
        long.iter().find(|e| e.id == id).cloned()
    }

    /// 关键词搜索
    async fn keyword_search(
        &self,
        keyword: &str,
        tier: Option<MemoryTier>,
    ) -> Result<Vec<MemoryEntry>, MemoryError> {
        let mut results = Vec::new();
        let keyword_lower = keyword.to_lowercase();

        // 搜索各层级
        if tier.is_none() || tier == Some(MemoryTier::ShortTerm) {
            let store = self.short_term.read().await;
            results.extend(
                store
                    .iter()
                    .filter(|e| e.content.to_lowercase().contains(&keyword_lower))
                    .cloned(),
            );
        }

        if tier.is_none() || tier == Some(MemoryTier::MediumTerm) {
            let store = self.medium_term.read().await;
            results.extend(
                store
                    .iter()
                    .filter(|e| e.content.to_lowercase().contains(&keyword_lower))
                    .cloned(),
            );
        }

        if tier.is_none() || tier == Some(MemoryTier::LongTerm) {
            let store = self.long_term.read().await;
            results.extend(
                store
                    .iter()
                    .filter(|e| e.content.to_lowercase().contains(&keyword_lower))
                    .cloned(),
            );
        }

        Ok(results)
    }

    /// 过滤和排序
    async fn filter_and_rank(
        &self,
        mut entries: Vec<MemoryEntry>,
        query: &MemoryQuery,
    ) -> Vec<MemoryEntry> {
        // 过滤
        entries.retain(|e| {
            if let Some(tier) = &query.tier {
                if e.tier != *tier {
                    return false;
                }
            }
            if let Some(mem_type) = &query.memory_type {
                if e.memory_type != *mem_type {
                    return false;
                }
            }
            if let Some(session) = &query.session_id {
                if e.metadata.session_id.as_ref() != Some(session) {
                    return false;
                }
            }
            if let Some(task) = &query.task_id {
                if e.metadata.task_id.as_ref() != Some(task) {
                    return false;
                }
            }
            if let Some((start, end)) = &query.time_range {
                if e.created_at < *start || e.created_at > *end {
                    return false;
                }
            }
            if !query.tags.is_empty() {
                if !query.tags.iter().all(|tag| e.metadata.tags.contains(tag)) {
                    return false;
                }
            }
            true
        });

        // 按综合分数排序 (重要性 * 衰减 * 访问频率)
        entries.sort_by(|a, b| {
            let score_a = self.calculate_memory_score(a);
            let score_b = self.calculate_memory_score(b);
            score_b.partial_cmp(&score_a).unwrap()
        });

        entries
    }

    /// 计算记忆分数
    fn calculate_memory_score(&self, entry: &MemoryEntry) -> f32 {
        let age_hours = (Utc::now() - entry.created_at).num_hours() as f32;
        let age_decay = (-entry.decay_factor * age_hours).exp();
        let access_boost = (entry.access_count as f32).ln_1p() * 0.1;
        
        entry.importance_score * age_decay * (1.0 + access_boost)
    }

    /// 增加访问计数
    async fn increment_access_count(&self, id: &str) -> Result<(), MemoryError> {
        // 短期记忆
        let mut short = self.short_term.write().await;
        if let Some(entry) = short.iter_mut().find(|e| e.id == id) {
            entry.access_count += 1;
            entry.updated_at = Utc::now();
            return Ok(());
        }
        drop(short);

        // 中期记忆
        let mut medium = self.medium_term.write().await;
        if let Some(entry) = medium.iter_mut().find(|e| e.id == id) {
            entry.access_count += 1;
            entry.updated_at = Utc::now();
            return Ok(());
        }
        drop(medium);

        // 长期记忆
        let mut long = self.long_term.write().await;
        if let Some(entry) = long.iter_mut().find(|e| e.id == id) {
            entry.access_count += 1;
            entry.updated_at = Utc::now();
        }

        Ok(())
    }

    /// 维护容量
    async fn maintain_capacity(
        &self,
        store: &mut Vec<MemoryEntry>,
        capacity: usize,
    ) -> Result<(), MemoryError> {
        if store.len() >= capacity {
            // 按分数排序，移除最低分的
            store.sort_by(|a, b| {
                let score_a = self.calculate_memory_score(a);
                let score_b = self.calculate_memory_score(b);
                score_a.partial_cmp(&score_b).unwrap()
            });

            // 迁移到下一层级或删除
            let to_remove = store.len() - capacity + 1;
            for _ in 0..to_remove {
                if let Some(entry) = store.first() {
                    self.handle_eviction(entry).await?;
                }
            }

            store.truncate(capacity - 1);
        }
        Ok(())
    }

    /// 处理驱逐
    async fn handle_eviction(&self, entry: &MemoryEntry) -> Result<(), MemoryError> {
        match entry.tier {
            MemoryTier::ShortTerm => {
                // 短期→中期
                if entry.importance_score > 0.5 {
                    let mut medium = self.medium_term.write().await;
                    let mut promoted = entry.clone();
                    promoted.tier = MemoryTier::MediumTerm;
                    promoted.decay_factor = self.calculate_decay_factor(MemoryTier::MediumTerm, entry.importance_score);
                    medium.push(promoted);
                }
            }
            MemoryTier::MediumTerm => {
                // 中期→长期
                if entry.importance_score > 0.7 {
                    let mut long = self.long_term.write().await;
                    let mut promoted = entry.clone();
                    promoted.tier = MemoryTier::LongTerm;
                    promoted.decay_factor = self.calculate_decay_factor(MemoryTier::LongTerm, entry.importance_score);
                    long.push(promoted);
                }
            }
            MemoryTier::LongTerm => {
                // 长期记忆归档（可选）
            }
        }
        Ok(())
    }

    /// 计算衰减系数
    fn calculate_decay_factor(&self, tier: MemoryTier, importance: f32) -> f32 {
        let base_factor = match tier {
            MemoryTier::ShortTerm => 0.5,
            MemoryTier::MediumTerm => 0.1,
            MemoryTier::LongTerm => 0.01,
        };
        base_factor * (1.0 - importance * 0.5) // 重要性越高衰减越慢
    }

    /// 定期清理过期记忆
    pub async fn cleanup(&self) -> Result<usize, MemoryError> {
        let mut removed = 0;

        // 清理短期记忆
        let mut short = self.short_term.write().await;
        let retention = Duration::minutes(self.config.short_term_retention_minutes);
        let before_len = short.len();
        short.retain(|e| Utc::now() - e.created_at < retention);
        removed += before_len - short.len();
        drop(short);

        // 清理中期记忆
        let mut medium = self.medium_term.write().await;
        let retention = Duration::hours(self.config.medium_term_retention_hours);
        let before_len = medium.len();
        medium.retain(|e| Utc::now() - e.created_at < retention);
        removed += before_len - medium.len();

        Ok(removed)
    }

    /// 获取统计信息
    pub async fn stats(&self) -> MemoryStats {
        MemoryStats {
            short_term_count: self.short_term.read().await.len(),
            medium_term_count: self.medium_term.read().await.len(),
            long_term_count: self.long_term.read().await.len(),
        }
    }
}

/// 记忆统计
#[derive(Debug, Clone)]
pub struct MemoryStats {
    pub short_term_count: usize,
    pub medium_term_count: usize,
    pub long_term_count: usize,
}

/// 记忆错误
#[derive(Debug, thiserror::Error)]
pub enum MemoryError {
    #[error("Storage error: {0}")]
    StorageError(String),
    
    #[error("Embedding error: {0}")]
    EmbeddingError(String),
    
    #[error("Vector store error: {0}")]
    VectorStoreError(String),
    
    #[error("Capacity exceeded")]
    CapacityExceeded,
}

// Stub modules
pub mod embeddings {
    use super::*;
    
    pub async fn generate_embedding(text: &str) -> Result<Vec<f32>, MemoryError> {
        // TODO: 集成真实嵌入模型
        // 目前返回零向量作为占位
        Ok(vec![0.0; 1536])
    }
}

pub mod vector_store {
    use super::*;
    use std::collections::HashMap;
    
    pub struct VectorStore {
        dim: usize,
        vectors: RwLock<HashMap<String, (Vec<f32>, MemoryTier)>>,
    }
    
    impl VectorStore {
        pub async fn new(dim: usize) -> Result<Self, MemoryError> {
            Ok(Self {
                dim,
                vectors: RwLock::new(HashMap::new()),
            })
        }
        
        pub async fn insert(&self, id: String, vector: Vec<f32>, tier: MemoryTier) -> Result<(), MemoryError> {
            self.vectors.write().await.insert(id, (vector, tier));
            Ok(())
        }
        
        pub async fn search(
            &self,
            query: &[f32],
            top_k: usize,
            tier: Option<MemoryTier>,
        ) -> Result<Vec<(String, f32)>, MemoryError> {
            let vectors = self.vectors.read().await;
            let mut results: Vec<(String, f32)> = vectors
                .iter()
                .filter(|(_, (_, t))| tier.is_none() || Some(*t) == tier)
                .map(|(id, (vec, _))| {
                    let similarity = cosine_similarity(query, vec);
                    (id.clone(), similarity)
                })
                .collect();
            
            results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
            Ok(results.into_iter().take(top_k).collect())
        }
    }
    
    fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
        let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
        let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
        let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
        dot / (norm_a * norm_b + 1e-8)
    }
}

pub mod decay {
    //! 衰减算法
    
    use super::*;
    
    /// 计算时间衰减后的重要性
    pub fn apply_decay(importance: f32, decay_factor: f32, hours: f32) -> f32 {
        importance * (-decay_factor * hours).exp()
    }
}
