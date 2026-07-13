//! OpenOxygen 2.0 Core Runtime
//!
//! 核心运行时，负责任务调度、状态管理和事件循环

pub mod error;
pub mod runtime;
pub mod scheduler;
pub mod state;

use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

use runtime::{BasicStepExecutor, RuntimeExecutor, StepExecutor};

/// 核心运行时实例
pub struct CoreRuntime {
    /// 任务调度器
    scheduler: Arc<RwLock<scheduler::TaskScheduler>>,
    /// 全局状态存储
    state: Arc<RwLock<state::GlobalState>>,
    /// 事件广播通道
    event_tx: broadcast::Sender<RuntimeEvent>,
    /// 步骤执行器
    step_executor: Arc<dyn StepExecutor>,
}

/// 运行时事件
#[derive(Debug, Clone)]
pub enum RuntimeEvent {
    TaskCreated {
        task_id: String,
    },
    TaskStarted {
        task_id: String,
    },
    StepStarted {
        task_id: String,
        step_id: String,
    },
    StepCompleted {
        task_id: String,
        step_id: String,
        output: serde_json::Value,
        duration_ms: u64,
    },
    StepFailed {
        task_id: String,
        step_id: String,
        error: String,
        duration_ms: u64,
    },
    TaskCompleted {
        task_id: String,
        result: TaskResult,
    },
    TaskFailed {
        task_id: String,
        error: String,
    },
    StateChanged {
        key: String,
        value: serde_json::Value,
    },
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
        Self::with_step_executor(Arc::new(BasicStepExecutor)).await
    }

    /// 使用指定步骤执行器创建运行时实例
    pub async fn with_step_executor(
        step_executor: Arc<dyn StepExecutor>,
    ) -> Result<Self, error::CoreError> {
        let (event_tx, _event_rx) = broadcast::channel(256);

        Ok(Self {
            scheduler: Arc::new(RwLock::new(scheduler::TaskScheduler::new())),
            state: Arc::new(RwLock::new(state::GlobalState::new())),
            event_tx,
            step_executor,
        })
    }

    /// 启动运行时
    pub async fn start(&self) -> Result<(), error::CoreError> {
        let scheduler = self.scheduler.clone();
        let event_tx = self.event_tx.clone();
        let step_executor = self.step_executor.clone();

        {
            let mut sched = scheduler.write().await;
            sched.start();
        }

        tokio::spawn(async move {
            let executor = RuntimeExecutor::new(step_executor);

            loop {
                let task = {
                    let mut sched = scheduler.write().await;
                    sched.next_task()
                };

                if let Some(task) = task {
                    let task_id = task.id.clone();
                    event_tx
                        .send(RuntimeEvent::TaskStarted {
                            task_id: task_id.clone(),
                        })
                        .ok();

                    match executor.execute(&task, &event_tx, &scheduler).await {
                        Ok(output) => {
                            let mut sched = scheduler.write().await;
                            sched.complete(&task_id, output.clone());
                            event_tx
                                .send(RuntimeEvent::TaskCompleted {
                                    task_id,
                                    result: TaskResult::Success(output),
                                })
                                .ok();
                        }
                        Err(err) => {
                            let error = err.to_string();
                            let mut sched = scheduler.write().await;
                            sched.fail(&task_id, error.clone());
                            event_tx
                                .send(RuntimeEvent::TaskFailed { task_id, error })
                                .ok();
                        }
                    }
                }

                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            }
        });

        Ok(())
    }

    /// 提交任务
    pub async fn submit_task(&self, task: scheduler::Task) -> Result<String, error::CoreError> {
        let task_id = task.id.clone();
        let mut scheduler = self.scheduler.write().await;
        scheduler.submit(task).await?;

        self.event_tx
            .send(RuntimeEvent::TaskCreated {
                task_id: task_id.clone(),
            })
            .ok();

        Ok(task_id)
    }

    /// 获取任务状态
    pub async fn get_task_status(&self, task_id: &str) -> Option<scheduler::TaskStatus> {
        let scheduler = self.scheduler.read().await;
        scheduler.get_status(task_id).await
    }

    /// 获取已完成任务输出
    pub async fn get_task_output(&self, task_id: &str) -> Option<serde_json::Value> {
        let scheduler = self.scheduler.read().await;
        scheduler.get_output(task_id)
    }

    /// 订阅运行时事件
    pub fn subscribe_events(&self) -> broadcast::Receiver<RuntimeEvent> {
        self.event_tx.subscribe()
    }

    /// 获取任务追踪记录
    pub async fn get_task_trace(&self, task_id: &str) -> Option<scheduler::TaskTrace> {
        let scheduler = self.scheduler.read().await;
        scheduler.get_task_trace(task_id)
    }

    /// 获取全局状态快照
    pub async fn state_snapshot(&self) -> state::GlobalState {
        self.state.read().await.clone()
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
