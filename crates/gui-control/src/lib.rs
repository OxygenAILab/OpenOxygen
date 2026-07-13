//! GUI 控制引擎
//!
//! 基于 Windows UIA、GDI 屏幕捕获和输入模拟的 GUI 自动化模块

pub mod capture;
pub mod controller;
pub mod input;
pub mod uia;
pub mod vision;

use std::future::Future;
use std::pin::Pin;

use openoxygen_core::error::CoreError;
use openoxygen_core::runtime::{StepExecutor, StepResult};
use openoxygen_core::scheduler::{GuiTarget, StepType, TaskStep};
use serde::{Deserialize, Serialize};

/// GUI 控制器
///
/// 顶层入口，整合 UIA、屏幕捕获、输入模拟、视觉处理
pub struct GuiController {
    inner: controller::GuiControllerImpl,
}

impl GuiController {
    /// 创建新的 GUI 控制器
    pub async fn new() -> Result<Self, GuiError> {
        Ok(Self {
            inner: controller::GuiControllerImpl::new()?,
        })
    }

    /// 执行 GUI 操作
    pub async fn execute(&self, action: GuiAction) -> Result<ActionResult, GuiError> {
        self.inner.execute(action).await
    }

    /// 获取当前屏幕所有可交互元素
    pub async fn get_interactive_elements(&self) -> Result<Vec<ElementInfo>, GuiError> {
        self.inner.get_interactive_elements().await
    }

    /// 等待元素出现
    pub async fn wait_for_element(
        &self,
        target: &Target,
        timeout_ms: u64,
    ) -> Result<ElementInfo, GuiError> {
        self.inner.wait_for_element(target, timeout_ms).await
    }

    /// 截图（返回 base64 编码的 PNG）
    pub async fn screenshot(&self) -> Result<String, GuiError> {
        self.inner.screenshot().await
    }
}

/// GUI 操作请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuiAction {
    pub action_type: ActionType,
    pub target: Target,
    pub params: ActionParams,
}

/// 动作类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionType {
    Click,
    DoubleClick,
    RightClick,
    Type,
    KeyCombo,
    Scroll,
    Drag,
    Hover,
    Wait,
    Screenshot,
}

/// 目标定义
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Target {
    #[serde(rename = "coordinates")]
    Coordinates { x: i32, y: i32 },
    #[serde(rename = "element")]
    Element {
        id: Option<String>,
        name: Option<String>,
        class: Option<String>,
    },
    #[serde(rename = "image")]
    Image {
        template: String,
        confidence: f32,
    },
    #[serde(rename = "text")]
    Text {
        content: String,
        partial: bool,
    },
    #[serde(rename = "description")]
    Description { desc: String },
}

/// 动作参数
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ActionParams {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keys: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<(i32, i32)>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub button: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// 操作结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionResult {
    pub success: bool,
    pub screenshot: Option<String>, // base64 encoded PNG
    pub element_info: Option<ElementInfo>,
    pub error: Option<String>,
    pub execution_time_ms: u64,
}

/// 元素信息（re-export from uia）
pub use uia::ElementInfo;

/// 矩形区域（re-export from uia）
pub use uia::Rect;

/// GUI 错误
#[derive(Debug, thiserror::Error)]
pub enum GuiError {
    #[error("UIA error: {0}")]
    UiaError(String),

    #[error("Capture error: {0}")]
    CaptureError(String),

    #[error("Vision error: {0}")]
    VisionError(String),

    #[error("Input error: {0}")]
    InputError(String),

    #[error("Invalid parameters: {0}")]
    InvalidParams(String),

    #[error("Unsupported action: {0}")]
    UnsupportedAction(String),

    #[error("Element not found: {0}")]
    ElementNotFound(String),

    #[error("Timeout: {0}")]
    Timeout(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Image error: {0}")]
    ImageError(#[from] image::ImageError),

    #[error("Windows API error: {0}")]
    WindowsError(String),
}

impl From<crate::uia::UiaError> for GuiError {
    fn from(e: crate::uia::UiaError) -> Self {
        GuiError::UiaError(e.to_string())
    }
}

impl StepExecutor for GuiController {
    fn execute_step<'a>(
        &'a self,
        step: &'a TaskStep,
    ) -> Pin<Box<dyn Future<Output = Result<StepResult, CoreError>> + Send + 'a>> {
        Box::pin(async move {
            let StepType::GuiAction { action } = &step.step_type else {
                return Err(CoreError::SchedulerError(format!(
                    "GuiController cannot execute step type: {:?}",
                    step.step_type
                )));
            };

            let gui_action = GuiAction {
                action_type: parse_action_type(&action.action_type)?,
                target: map_target(&action.target),
                params: parse_action_params(&action.params)?,
            };

            let result = self
                .execute(gui_action)
                .await
                .map_err(|err| CoreError::SchedulerError(err.to_string()))?;

            Ok(StepResult {
                success: result.success,
                output: serde_json::to_value(result)?,
            })
        })
    }
}

fn parse_action_type(action_type: &str) -> Result<ActionType, CoreError> {
    match action_type {
        "click" => Ok(ActionType::Click),
        "double_click" => Ok(ActionType::DoubleClick),
        "right_click" => Ok(ActionType::RightClick),
        "type" => Ok(ActionType::Type),
        "key_combo" => Ok(ActionType::KeyCombo),
        "scroll" => Ok(ActionType::Scroll),
        "drag" => Ok(ActionType::Drag),
        "hover" => Ok(ActionType::Hover),
        "wait" => Ok(ActionType::Wait),
        "screenshot" => Ok(ActionType::Screenshot),
        other => Err(CoreError::InvalidConfiguration(format!(
            "Unsupported GUI action type: {other}"
        ))),
    }
}

fn parse_action_params(params: &serde_json::Value) -> Result<ActionParams, CoreError> {
    if params.is_null() {
        return Ok(ActionParams::default());
    }

    Ok(serde_json::from_value(params.clone())?)
}

fn map_target(target: &GuiTarget) -> Target {
    match target {
        GuiTarget::Coordinates { x, y } => Target::Coordinates { x: *x, y: *y },
        GuiTarget::ElementId { id } => Target::Element {
            id: Some(id.clone()),
            name: None,
            class: None,
        },
        GuiTarget::Description { desc } => Target::Description { desc: desc.clone() },
        GuiTarget::ImageMatch {
            template,
            confidence,
        } => Target::Image {
            template: template.clone(),
            confidence: *confidence,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use openoxygen_cli_executor::CliExecutor;
    use openoxygen_core::runtime::StepExecutorDispatcher;
    use openoxygen_core::scheduler::{GuiAction as CoreGuiAction, Task, TaskPriority, TaskStatus};
    use openoxygen_core::CoreRuntime;
    use std::collections::HashMap;
    use std::sync::Arc;

    fn gui_click_step() -> TaskStep {
        TaskStep {
            id: "click".to_string(),
            step_type: StepType::GuiAction {
                action: CoreGuiAction {
                    action_type: "click".to_string(),
                    target: GuiTarget::Coordinates { x: 0, y: 0 },
                    params: serde_json::Value::Null,
                },
            },
            params: serde_json::Value::Null,
            depends_on: Vec::new(),
        }
    }

    #[tokio::test]
    async fn gui_controller_executes_step() {
        let controller = GuiController::new().await.expect("create gui controller");
        let result = controller
            .execute_step(&gui_click_step())
            .await
            .expect("execute gui step");

        assert!(result.success);
        assert_eq!(result.output["success"], true);
    }

    #[tokio::test]
    async fn runtime_executes_gui_task_to_completion() {
        let controller = Arc::new(GuiController::new().await.expect("create gui controller"));
        let runtime = CoreRuntime::with_step_executor(controller)
            .await
            .expect("create runtime");

        runtime.start().await.expect("start runtime");

        let task_id = "gui-e2e".to_string();
        let task = Task {
            id: task_id.clone(),
            name: "GUI E2E".to_string(),
            description: "Run a GUI action through CoreRuntime".to_string(),
            priority: TaskPriority::Normal,
            steps: vec![gui_click_step()],
            metadata: HashMap::new(),
            created_at: Utc::now(),
        };

        runtime.submit_task(task).await.expect("submit task");

        for _ in 0..30 {
            if let Some(TaskStatus::Completed { .. }) = runtime.get_task_status(&task_id).await {
                return;
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }

        panic!("task did not complete: {:?}", runtime.get_task_status(&task_id).await);
    }

    #[tokio::test]
    async fn runtime_dispatches_cli_wait_and_gui_steps() {
        let cli = Arc::new(CliExecutor::new().expect("create cli executor"));
        let gui = Arc::new(GuiController::new().await.expect("create gui controller"));
        let dispatcher = Arc::new(
            StepExecutorDispatcher::new()
                .with_cli_executor(cli)
                .with_gui_executor(gui),
        );
        let runtime = CoreRuntime::with_step_executor(dispatcher)
            .await
            .expect("create runtime");

        runtime.start().await.expect("start runtime");

        let task_id = "mixed-e2e".to_string();
        let task = Task {
            id: task_id.clone(),
            name: "Mixed E2E".to_string(),
            description: "Run CLI, wait, and GUI steps through dispatcher".to_string(),
            priority: TaskPriority::Normal,
            steps: vec![
                TaskStep {
                    id: "cli".to_string(),
                    step_type: StepType::CliCommand {
                        command: "echo openoxygen-dispatch".to_string(),
                        cwd: None,
                    },
                    params: serde_json::Value::Null,
                    depends_on: Vec::new(),
                },
                TaskStep {
                    id: "wait".to_string(),
                    step_type: StepType::Wait { duration_ms: 1 },
                    params: serde_json::Value::Null,
                    depends_on: vec!["cli".to_string()],
                },
                TaskStep {
                    id: "gui".to_string(),
                    depends_on: vec!["wait".to_string()],
                    ..gui_click_step()
                },
            ],
            metadata: HashMap::new(),
            created_at: Utc::now(),
        };

        runtime.submit_task(task).await.expect("submit task");

        for _ in 0..30 {
            if let Some(TaskStatus::Completed { .. }) = runtime.get_task_status(&task_id).await {
                return;
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }

        panic!("task did not complete: {:?}", runtime.get_task_status(&task_id).await);
    }
}
