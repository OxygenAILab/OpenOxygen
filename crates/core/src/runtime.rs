//! 运行时模块
//!
//! 核心运行时的子模块实现

use std::collections::HashSet;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use tokio::sync::{broadcast, RwLock};

use crate::error::CoreError;
use crate::scheduler::{StepEvent, StepEventType, StepType, Task, TaskScheduler, TaskStep};
use crate::RuntimeEvent;

/// 步骤执行结果
#[derive(Debug, Clone)]
pub struct StepResult {
    pub success: bool,
    pub output: serde_json::Value,
}

impl StepResult {
    pub fn success(output: serde_json::Value) -> Self {
        Self {
            success: true,
            output,
        }
    }
}

/// 可注入的步骤执行接口
pub trait StepExecutor: Send + Sync {
    fn execute_step<'a>(
        &'a self,
        step: &'a TaskStep,
    ) -> Pin<Box<dyn Future<Output = Result<StepResult, CoreError>> + Send + 'a>>;
}

/// 按步骤类型路由的执行分发器
pub struct StepExecutorDispatcher {
    basic_executor: Arc<dyn StepExecutor>,
    gui_executor: Option<Arc<dyn StepExecutor>>,
    cli_executor: Option<Arc<dyn StepExecutor>>,
    browser_executor: Option<Arc<dyn StepExecutor>>,
    llm_executor: Option<Arc<dyn StepExecutor>>,
}

impl StepExecutorDispatcher {
    pub fn new() -> Self {
        Self {
            basic_executor: Arc::new(BasicStepExecutor),
            gui_executor: None,
            cli_executor: None,
            browser_executor: None,
            llm_executor: None,
        }
    }

    pub fn with_basic_executor(mut self, executor: Arc<dyn StepExecutor>) -> Self {
        self.basic_executor = executor;
        self
    }

    pub fn with_gui_executor(mut self, executor: Arc<dyn StepExecutor>) -> Self {
        self.gui_executor = Some(executor);
        self
    }

    pub fn with_cli_executor(mut self, executor: Arc<dyn StepExecutor>) -> Self {
        self.cli_executor = Some(executor);
        self
    }

    pub fn with_browser_executor(mut self, executor: Arc<dyn StepExecutor>) -> Self {
        self.browser_executor = Some(executor);
        self
    }

    pub fn with_llm_executor(mut self, executor: Arc<dyn StepExecutor>) -> Self {
        self.llm_executor = Some(executor);
        self
    }

    fn executor_for(&self, step_type: &StepType) -> Result<Arc<dyn StepExecutor>, CoreError> {
        match step_type {
            StepType::Wait { .. } | StepType::Condition { .. } => Ok(self.basic_executor.clone()),
            StepType::GuiAction { .. } => self.gui_executor.clone().ok_or_else(|| {
                CoreError::SchedulerError("GUI executor is not registered".to_string())
            }),
            StepType::CliCommand { .. } => self.cli_executor.clone().ok_or_else(|| {
                CoreError::SchedulerError("CLI executor is not registered".to_string())
            }),
            StepType::BrowserAction { .. } => self.browser_executor.clone().ok_or_else(|| {
                CoreError::SchedulerError("Browser executor is not registered".to_string())
            }),
            StepType::LlmInference { .. } => self.llm_executor.clone().ok_or_else(|| {
                CoreError::SchedulerError("LLM executor is not registered".to_string())
            }),
        }
    }
}

impl Default for StepExecutorDispatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl StepExecutor for StepExecutorDispatcher {
    fn execute_step<'a>(
        &'a self,
        step: &'a TaskStep,
    ) -> Pin<Box<dyn Future<Output = Result<StepResult, CoreError>> + Send + 'a>> {
        Box::pin(async move {
            let executor = self.executor_for(&step.step_type)?;
            executor.execute_step(step).await
        })
    }
}

/// 基础步骤执行器
pub struct BasicStepExecutor;

impl StepExecutor for BasicStepExecutor {
    fn execute_step<'a>(
        &'a self,
        step: &'a TaskStep,
    ) -> Pin<Box<dyn Future<Output = Result<StepResult, CoreError>> + Send + 'a>> {
        Box::pin(async move {
            match &step.step_type {
                StepType::Wait { duration_ms } => {
                    tokio::time::sleep(tokio::time::Duration::from_millis(*duration_ms)).await;
                    Ok(StepResult::success(serde_json::Value::Null))
                }
                StepType::Condition { check } => Ok(StepResult::success(serde_json::json!({
                    "check": check,
                    "passed": true
                }))),
                StepType::GuiAction { .. }
                | StepType::CliCommand { .. }
                | StepType::BrowserAction { .. }
                | StepType::LlmInference { .. } => Err(CoreError::SchedulerError(
                    "Step type is not wired to an executor yet".to_string(),
                )),
            }
        })
    }
}

/// 运行时执行器
pub struct RuntimeExecutor {
    step_executor: Arc<dyn StepExecutor>,
}

impl RuntimeExecutor {
    /// 创建新的执行器
    pub fn new(step_executor: Arc<dyn StepExecutor>) -> Self {
        Self { step_executor }
    }

    /// 创建基础执行器
    pub fn basic() -> Self {
        Self::new(Arc::new(BasicStepExecutor))
    }

    /// 执行任务
    pub async fn execute(
        &self,
        task: &Task,
        event_tx: &broadcast::Sender<RuntimeEvent>,
        scheduler: &Arc<RwLock<TaskScheduler>>,
    ) -> Result<serde_json::Value, CoreError> {
        let mut completed_steps = HashSet::new();
        let mut step_outputs = serde_json::Map::new();
        let task_id = task.id.clone();

        while completed_steps.len() < task.steps.len() {
            let mut progressed = false;

            for step in &task.steps {
                if completed_steps.contains(&step.id) {
                    continue;
                }

                if !step
                    .depends_on
                    .iter()
                    .all(|id| completed_steps.contains(id))
                {
                    continue;
                }

                let step_started = chrono::Utc::now();
                let step_id = step.id.clone();

                // 发出 StepStarted 事件
                let started_event = StepEvent {
                    task_id: task_id.clone(),
                    step_id: step_id.clone(),
                    event_type: StepEventType::StepStarted,
                    timestamp: step_started,
                };
                {
                    let mut sched = scheduler.write().await;
                    sched.record_step_event(started_event);
                }
                event_tx
                    .send(RuntimeEvent::StepStarted {
                        task_id: task_id.clone(),
                        step_id: step_id.clone(),
                    })
                    .ok();

                let result = self.step_executor.execute_step(step).await;
                let duration_ms = (chrono::Utc::now() - step_started).num_milliseconds() as u64;

                match result {
                    Ok(output) => {
                        if !output.success {
                            let error = format!("Step failed: {}", step_id);
                            let failed_event = StepEvent {
                                task_id: task_id.clone(),
                                step_id: step_id.clone(),
                                event_type: StepEventType::StepFailed {
                                    error: error.clone(),
                                    duration_ms,
                                },
                                timestamp: chrono::Utc::now(),
                            };
                            {
                                let mut sched = scheduler.write().await;
                                sched.record_step_event(failed_event);
                            }
                            event_tx
                                .send(RuntimeEvent::StepFailed {
                                    task_id: task_id.clone(),
                                    step_id: step_id.clone(),
                                    error: error.clone(),
                                    duration_ms,
                                })
                                .ok();
                            return Err(CoreError::SchedulerError(error));
                        }

                        let completed_event = StepEvent {
                            task_id: task_id.clone(),
                            step_id: step_id.clone(),
                            event_type: StepEventType::StepCompleted {
                                output: output.output.clone(),
                                duration_ms,
                            },
                            timestamp: chrono::Utc::now(),
                        };
                        {
                            let mut sched = scheduler.write().await;
                            sched.record_step_event(completed_event);
                        }
                        event_tx
                            .send(RuntimeEvent::StepCompleted {
                                task_id: task_id.clone(),
                                step_id: step_id.clone(),
                                output: output.output.clone(),
                                duration_ms,
                            })
                            .ok();

                        step_outputs.insert(step_id.clone(), output.output);
                        completed_steps.insert(step_id.clone());
                        progressed = true;
                    }
                    Err(err) => {
                        let error = err.to_string();
                        let failed_event = StepEvent {
                            task_id: task_id.clone(),
                            step_id: step_id.clone(),
                            event_type: StepEventType::StepFailed {
                                error: error.clone(),
                                duration_ms,
                            },
                            timestamp: chrono::Utc::now(),
                        };
                        {
                            let mut sched = scheduler.write().await;
                            sched.record_step_event(failed_event);
                        }
                        event_tx
                            .send(RuntimeEvent::StepFailed {
                                task_id: task_id.clone(),
                                step_id: step_id.clone(),
                                error: error.clone(),
                                duration_ms,
                            })
                            .ok();
                        return Err(CoreError::SchedulerError(error));
                    }
                }
            }

            if !progressed {
                return Err(CoreError::SchedulerError(format!(
                    "Task has unresolved step dependencies: {}",
                    task_id
                )));
            }
        }

        Ok(serde_json::Value::Object(step_outputs))
    }
}

impl Default for RuntimeExecutor {
    fn default() -> Self {
        Self::basic()
    }
}
