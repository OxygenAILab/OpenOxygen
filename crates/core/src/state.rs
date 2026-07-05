//! 全局状态管理
//! 
//! 提供键值存储和向量记忆功能

use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 全局状态
pub struct GlobalState {
    /// 键值存储
    kv_store: HashMap<String, Value>,
    /// 会话状态
    sessions: HashMap<String, SessionState>,
}

/// 会话状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionState {
    pub id: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub data: HashMap<String, Value>,
}

impl GlobalState {
    pub fn new() -> Self {
        Self {
            kv_store: HashMap::new(),
            sessions: HashMap::new(),
        }
    }

    /// 设置键值
    pub fn set(&mut self, key: impl Into<String>, value: Value) {
        self.kv_store.insert(key.into(), value);
    }

    /// 获取键值
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.kv_store.get(key)
    }

    /// 删除键值
    pub fn delete(&mut self, key: &str) -> Option<Value> {
        self.kv_store.remove(key)
    }

    /// 创建会话
    pub fn create_session(&mut self, session_id: impl Into<String>) -> String {
        let id = session_id.into();
        let session = SessionState {
            id: id.clone(),
            created_at: chrono::Utc::now(),
            data: HashMap::new(),
        };
        self.sessions.insert(id.clone(), session);
        id
    }

    /// 获取会话
    pub fn get_session(&self, session_id: &str) -> Option<&SessionState> {
        self.sessions.get(session_id)
    }

    /// 更新会话数据
    pub fn update_session(&mut self, session_id: &str, key: impl Into<String>, value: Value) -> Result<(), String> {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.data.insert(key.into(), value);
            Ok(())
        } else {
            Err(format!("Session not found: {}", session_id))
        }
    }
}

impl Default for GlobalState {
    fn default() -> Self {
        Self::new()
    }
}
