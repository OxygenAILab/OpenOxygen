//! OpenOxygen 2.0 Core Runtime
//! 
//! 核心运行时，负责任务调度、状态管理和事件循环

pub mod runtime;
pub mod scheduler;
pub mod state;
pub mod error;

use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};

/// 核心运行时实例
pub struct CoreRuntime {
    /// 任务调度器
    scheduler: Arc<RwLock<scheduler::TaskScheduler>>,
    /// 全局状态存储
    state: Arc<RwLock<state::GlobalState>>,
    /// 事件通道
    event_tx: mpsc::Sender<RuntimeEvent>,
}

/// 运行时事件
#[derive(Debug, Clone)]
pub enum RuntimeEvent {
    TaskCreated { task_id: String },
    TaskStarted { task_id: String },
    TaskCompleted { task_id: String, result: TaskResult },
    TaskFailed { task_id: String, error: String },
    StateChanged { key: String, value: serde_json::Value },
}

/// 任务执行结果
#[derive(Debug, Clone)]
pub enum TaskResult {
    Success(serde_json::Value),
    Failure(String),
    Cancelled,
}

impl CoreRuntime {
    /// 创建新的运行时实例
    pub async fn new() -> Result<Self, error::CoreError> {
        let (event_tx, _event_rx) = mpsc::channel(1024);
        
        Ok(Self {
            scheduler: Arc::new(RwLock::new(scheduler::TaskScheduler::new())),
            state: Arc::new(RwLock::new(state::GlobalState::new())),
            event_tx,
        })
    }

    /// 启动运行时
    pub async fn start(&self) -> Result<(), error::CoreError> {
        // 启动调度器
        let scheduler = self.scheduler.clone();
        tokio::spawn(async move {
            let mut sched = scheduler.write().await;
            sched.start().await;
        });
        
        Ok(())
    }

    /// 提交任务
    pub async fn submit_task(&self, task: scheduler::Task) -> Result<String, error::CoreError> {
        let task_id = task.id.clone();
        let mut scheduler = self.scheduler.write().await;
        scheduler.submit(task).await?;
        
        self.event_tx.send(RuntimeEvent::TaskCreated { 
            task_id: task_id.clone() 
        }).await.ok();
        
        Ok(task_id)
    }

    /// 获取任务状态
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
