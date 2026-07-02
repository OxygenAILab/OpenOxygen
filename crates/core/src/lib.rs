//! OpenOxygen 2.0 Core Runtime
//! 
//! Core runtime responsible for task scheduling, state management, and event loop
//! GitHub@StarsailsClover

pub mod scheduler;
pub mod state;
pub mod error;

use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use serde_json;

/// Core runtime implementation
pub struct CoreRuntime {
    /// Task scheduler
    scheduler: Arc<RwLock<scheduler::TaskScheduler>>,
    /// Global state storage
    state: Arc<RwLock<state::GlobalState>>,
    /// Event channel
    event_tx: mpsc::Sender<RuntimeEvent>,
}

/// Runtime events
#[derive(Debug, Clone)]
pub enum RuntimeEvent {
    TaskCreated { task_id: String },
    TaskStarted { task_id: String },
    TaskCompleted { task_id: String, result: TaskResult },
    TaskFailed { task_id: String, error: String },
    StateChanged { key: String, value: serde_json::Value },
}

/// Task execution result
#[derive(Debug, Clone)]
pub enum TaskResult {
    Success(serde_json::Value),
    Failure(String),
    Cancelled,
}

impl CoreRuntime {
    /// Create new runtime instance
    pub async fn new() -> Result<Self, error::CoreError> {
        let (event_tx, _event_rx) = mpsc::channel(1024);
        
        Ok(Self {
            scheduler: Arc::new(RwLock::new(scheduler::TaskScheduler::new())),
            state: Arc::new(RwLock::new(state::GlobalState::new())),
            event_tx,
        })
    }

    /// Start runtime
    pub async fn start(&self) -> Result<(), error::CoreError> {
        let scheduler = self.scheduler.clone();
        tokio::spawn(async move {
            let mut sched = scheduler.write().await;
            sched.start().await;
        });
        
        Ok(())
    }

    /// Submit task
    pub async fn submit_task(&self, task: scheduler::Task) -> Result<String, error::CoreError> {
        let task_id = task.id.clone();
        let mut scheduler = self.scheduler.write().await;
        scheduler.submit(task).await?;
        
        self.event_tx.send(RuntimeEvent::TaskCreated { 
            task_id: task_id.clone() 
        }).await.ok();
        
        Ok(task_id)
    }

    /// Get task status
    pub async fn get_task_status(&self, task_id: &str) -> Option<scheduler::TaskStatus> {
        let scheduler = self.scheduler.read().await;
        scheduler.get_status(task_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_runtime_creation() {
        let runtime = CoreRuntime::new().await;
        assert!(runtime.is_ok());
    }
}
