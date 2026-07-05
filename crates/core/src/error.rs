//! 核心错误定义

use thiserror::Error;

#[derive(Error, Debug)]
pub enum CoreError {
    #[error("Task not found: {0}")]
    TaskNotFound(String),
    
    #[error("Task already exists: {0}")]
    TaskAlreadyExists(String),
    
    #[error("Invalid task configuration: {0}")]
    InvalidConfiguration(String),
    
    #[error("Scheduler error: {0}")]
    SchedulerError(String),
    
    #[error("State error: {0}")]
    StateError(String),
    
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    
    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),
    
    #[error("Channel error: {0}")]
    ChannelError(String),
}

impl<T> From<tokio::sync::mpsc::error::SendError<T>> for CoreError {
    fn from(err: tokio::sync::mpsc::error::SendError<T>) -> Self {
        CoreError::ChannelError(err.to_string())
    }
}
