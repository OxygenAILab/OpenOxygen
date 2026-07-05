//! GUI 控制引擎
//!
//! 基于 Windows UIA、GDI 屏幕捕获和输入模拟的 GUI 自动化模块

pub mod capture;
pub mod controller;
pub mod input;
pub mod uia;
pub mod vision;

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
