use std::future::Future;
use std::pin::Pin;

use chrono::{DateTime, Utc};
use openoxygen_core::error::CoreError;
use openoxygen_core::runtime::{StepExecutor, StepResult};
use openoxygen_core::scheduler::{StepType, TaskStep};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct BrowserExecutor {
    backend: BrowserBackend,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrowserBackend {
    Stub,
}

impl BrowserExecutor {
    pub fn new() -> Self {
        Self {
            backend: BrowserBackend::Stub,
        }
    }

    pub fn with_backend(backend: BrowserBackend) -> Self {
        Self { backend }
    }

    pub async fn execute(&self, action: BrowserRequest) -> Result<BrowserResult, BrowserError> {
        let started_at = Utc::now();
        let start = std::time::Instant::now();
        let output = match action.action_type.as_str() {
            "navigate" => serde_json::json!({
                "url": action.params.get("url").and_then(serde_json::Value::as_str).unwrap_or_default()
            }),
            "click" => serde_json::json!({
                "selector": action.params.get("selector").and_then(serde_json::Value::as_str).unwrap_or_default()
            }),
            "type" => serde_json::json!({
                "selector": action.params.get("selector").and_then(serde_json::Value::as_str).unwrap_or_default(),
                "text": action.params.get("text").and_then(serde_json::Value::as_str).unwrap_or_default()
            }),
            "screenshot" => serde_json::json!({
                "screenshot": null
            }),
            "evaluate" => serde_json::json!({
                "script": action.params.get("script").and_then(serde_json::Value::as_str).unwrap_or_default(),
                "value": null
            }),
            "get_page_source" => serde_json::json!({
                "html": ""
            }),
            other => return Err(BrowserError::UnsupportedAction(other.to_string())),
        };

        Ok(BrowserResult {
            success: true,
            action_type: action.action_type,
            backend: self.backend.clone(),
            output,
            started_at,
            completed_at: Utc::now(),
            duration_ms: start.elapsed().as_millis() as u64,
        })
    }
}

impl Default for BrowserExecutor {
    fn default() -> Self {
        Self::new()
    }
}

impl StepExecutor for BrowserExecutor {
    fn execute_step<'a>(
        &'a self,
        step: &'a TaskStep,
    ) -> Pin<Box<dyn Future<Output = Result<StepResult, CoreError>> + Send + 'a>> {
        Box::pin(async move {
            let StepType::BrowserAction { action } = &step.step_type else {
                return Err(CoreError::SchedulerError(format!(
                    "BrowserExecutor cannot execute step type: {:?}",
                    step.step_type
                )));
            };

            let request = BrowserRequest {
                action_type: action.action_type.clone(),
                params: action.params.clone(),
            };
            let result = self
                .execute(request)
                .await
                .map_err(|err| CoreError::SchedulerError(err.to_string()))?;

            Ok(StepResult::success(serde_json::to_value(result)?))
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserRequest {
    pub action_type: String,
    pub params: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserResult {
    pub success: bool,
    pub action_type: String,
    pub backend: BrowserBackend,
    pub output: serde_json::Value,
    pub started_at: DateTime<Utc>,
    pub completed_at: DateTime<Utc>,
    pub duration_ms: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum BrowserError {
    #[error("Unsupported browser action: {0}")]
    UnsupportedAction(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use openoxygen_cli_executor::CliExecutor;
    use openoxygen_core::runtime::StepExecutorDispatcher;
    use openoxygen_core::scheduler::{
        BrowserAction, GuiAction, GuiTarget, Task, TaskPriority, TaskStatus,
    };
    use openoxygen_core::CoreRuntime;
    use openoxygen_core::RuntimeEvent;
    use openoxygen_gui_control::GuiController;
    use openoxygen_vlm_connector::{VlmConfig, VlmConnector};
    use std::collections::HashMap;
    use std::sync::Arc;

    fn browser_step() -> TaskStep {
        TaskStep {
            id: "browser".to_string(),
            step_type: StepType::BrowserAction {
                action: BrowserAction {
                    action_type: "navigate".to_string(),
                    params: serde_json::json!({
                        "url": "https://example.com"
                    }),
                },
            },
            params: serde_json::Value::Null,
            depends_on: Vec::new(),
        }
    }

    #[tokio::test]
    async fn browser_executor_executes_step() {
        let executor = BrowserExecutor::new();
        let result = executor
            .execute_step(&browser_step())
            .await
            .expect("execute browser step");

        assert!(result.success);
        assert_eq!(result.output["action_type"], "navigate");
        assert_eq!(result.output["output"]["url"], "https://example.com");
    }

    #[tokio::test]
    async fn runtime_dispatches_browser_step_to_completion() {
        let browser = Arc::new(BrowserExecutor::new());
        let dispatcher = Arc::new(StepExecutorDispatcher::new().with_browser_executor(browser));
        let runtime = CoreRuntime::with_step_executor(dispatcher)
            .await
            .expect("create runtime");

        runtime.start().await.expect("start runtime");

        let task_id = "browser-e2e".to_string();
        let task = Task {
            id: task_id.clone(),
            name: "Browser E2E".to_string(),
            description: "Run a browser action step through CoreRuntime".to_string(),
            priority: TaskPriority::Normal,
            steps: vec![browser_step()],
            metadata: HashMap::new(),
            created_at: Utc::now(),
        };

        runtime.submit_task(task).await.expect("submit task");

        for _ in 0..30 {
            if let Some(TaskStatus::Completed { .. }) = runtime.get_task_status(&task_id).await {
                let output = runtime.get_task_output(&task_id).await.expect("task output");
                assert_eq!(output["browser"]["action_type"], "navigate");

                // 验证 TaskTrace
                let trace = runtime.get_task_trace(&task_id).await.expect("task trace");
                assert_eq!(trace.task_id, task_id);
                assert_eq!(trace.events.len(), 2); // StepStarted + StepCompleted
                assert!(matches!(
                    trace.events[0].event_type,
                    openoxygen_core::scheduler::StepEventType::StepStarted
                ));
                assert!(matches!(
                    trace.events[1].event_type,
                    openoxygen_core::scheduler::StepEventType::StepCompleted { .. }
                ));
                return;
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }

        panic!("task did not complete: {:?}", runtime.get_task_status(&task_id).await);
    }

    #[tokio::test]
    async fn runtime_dispatches_full_executor_chain_to_completion() {
        let cli = Arc::new(CliExecutor::new().expect("create cli executor"));
        let gui = Arc::new(GuiController::new().await.expect("create gui controller"));
        let llm = Arc::new(VlmConnector::new(VlmConfig::default()).expect("create vlm connector"));
        let browser = Arc::new(BrowserExecutor::new());
        let dispatcher = Arc::new(
            StepExecutorDispatcher::new()
                .with_cli_executor(cli)
                .with_gui_executor(gui)
                .with_llm_executor(llm)
                .with_browser_executor(browser),
        );
        let runtime = CoreRuntime::with_step_executor(dispatcher)
            .await
            .expect("create runtime");

        runtime.start().await.expect("start runtime");

        let task_id = "full-executor-chain".to_string();
        let task = Task {
            id: task_id.clone(),
            name: "Full Executor Chain".to_string(),
            description: "Run CLI, GUI, LLM, Browser, and Wait through one dispatcher".to_string(),
            priority: TaskPriority::Normal,
            steps: vec![
                TaskStep {
                    id: "cli".to_string(),
                    step_type: StepType::CliCommand {
                        command: "echo openoxygen-full-chain".to_string(),
                        cwd: None,
                    },
                    params: serde_json::Value::Null,
                    depends_on: Vec::new(),
                },
                TaskStep {
                    id: "gui".to_string(),
                    step_type: StepType::GuiAction {
                        action: GuiAction {
                            action_type: "click".to_string(),
                            target: GuiTarget::Coordinates { x: 0, y: 0 },
                            params: serde_json::Value::Null,
                        },
                    },
                    params: serde_json::Value::Null,
                    depends_on: vec!["cli".to_string()],
                },
                TaskStep {
                    id: "llm".to_string(),
                    step_type: StepType::LlmInference {
                        prompt: "Summarize the OpenOxygen executor chain".to_string(),
                        model: Some("stub-llm".to_string()),
                    },
                    params: serde_json::Value::Null,
                    depends_on: vec!["gui".to_string()],
                },
                TaskStep {
                    id: "browser".to_string(),
                    depends_on: vec!["llm".to_string()],
                    ..browser_step()
                },
                TaskStep {
                    id: "wait".to_string(),
                    step_type: StepType::Wait { duration_ms: 1 },
                    params: serde_json::Value::Null,
                    depends_on: vec!["browser".to_string()],
                },
            ],
            metadata: HashMap::new(),
            created_at: Utc::now(),
        };

        runtime.submit_task(task).await.expect("submit task");

        for _ in 0..30 {
            if let Some(TaskStatus::Completed { .. }) = runtime.get_task_status(&task_id).await {
                let output = runtime.get_task_output(&task_id).await.expect("task output");
                assert!(output["cli"]["stdout"]
                    .as_str()
                    .unwrap()
                    .contains("openoxygen-full-chain"));
                assert_eq!(output["gui"]["success"], true);
                assert_eq!(output["llm"]["model"], "stub-llm");
                assert_eq!(output["browser"]["action_type"], "navigate");
                assert!(output.get("wait").is_some());

                // 验证 TaskTrace: 5 个步骤各应有 StepStarted + StepCompleted = 10 个事件
                let trace = runtime.get_task_trace(&task_id).await.expect("task trace");
                assert_eq!(trace.task_id, task_id);
                assert_eq!(trace.events.len(), 10); // 5 steps * 2 events each
                let step_ids: Vec<&str> = trace
                    .events
                    .iter()
                    .filter_map(|e| match &e.event_type {
                        openoxygen_core::scheduler::StepEventType::StepStarted => {
                            Some(e.step_id.as_str())
                        }
                        _ => None,
                    })
                    .collect();
                assert!(step_ids.contains(&"cli"));
                assert!(step_ids.contains(&"gui"));
                assert!(step_ids.contains(&"llm"));
                assert!(step_ids.contains(&"browser"));
                assert!(step_ids.contains(&"wait"));
                return;
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }

        panic!("task did not complete: {:?}", runtime.get_task_status(&task_id).await);
    }

    #[tokio::test]
    async fn subscribe_events_receives_step_events() {
        let browser = Arc::new(BrowserExecutor::new());
        let dispatcher = Arc::new(StepExecutorDispatcher::new().with_browser_executor(browser));
        let runtime = CoreRuntime::with_step_executor(dispatcher)
            .await
            .expect("create runtime");

        let mut event_rx = runtime.subscribe_events();
        runtime.start().await.expect("start runtime");

        let task_id = "event-sub".to_string();
        let task = Task {
            id: task_id.clone(),
            name: "Event Subscription Test".to_string(),
            description: "Verify step events are emitted via broadcast".to_string(),
            priority: TaskPriority::Normal,
            steps: vec![browser_step()],
            metadata: HashMap::new(),
            created_at: Utc::now(),
        };

        runtime.submit_task(task).await.expect("submit task");

        let mut saw_task_started = false;
        let mut saw_step_started = false;
        let mut saw_step_completed = false;
        let mut saw_task_completed = false;

        for _ in 0..50 {
            match event_rx.try_recv() {
                Ok(RuntimeEvent::TaskStarted { .. }) => saw_task_started = true,
                Ok(RuntimeEvent::StepStarted { .. }) => saw_step_started = true,
                Ok(RuntimeEvent::StepCompleted { .. }) => saw_step_completed = true,
                Ok(RuntimeEvent::TaskCompleted { .. }) => saw_task_completed = true,
                _ => {}
            }

            if saw_task_started && saw_step_started && saw_step_completed && saw_task_completed {
                break;
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }

        assert!(saw_task_started, "should receive TaskStarted event");
        assert!(saw_step_started, "should receive StepStarted event");
        assert!(saw_step_completed, "should receive StepCompleted event");
        assert!(saw_task_completed, "should receive TaskCompleted event");
    }
}
