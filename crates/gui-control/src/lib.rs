//! GUI 控制引擎
//! 
//! 基于 Windows UIA 和计算机视觉的 GUI 自动化
//! 对标 UI-TARS 的视觉驱动方式

use std::sync::Arc;
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};

pub mod capture;
pub mod uia;
pub mod vision;
pub mod input;

/// GUI 控制引擎
pub struct GuiController {
    /// 屏幕捕获器
    capture: Arc<RwLock<capture::ScreenCapture>>,
    /// UIA 自动化
    uia: Arc<RwLock<uia::UiaAutomation>>,
    /// 视觉处理器
    vision: Arc<RwLock<vision::VisionProcessor>>,
    /// 输入模拟器
    input: Arc<RwLock<input::InputSimulator>>,
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
    Element { id: Option<String>, name: Option<String>, class: Option<String> },
    #[serde(rename = "image")]
    Image { template: String, confidence: f32 },
    #[serde(rename = "text")]
    Text { content: String, partial: bool },
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
    pub screenshot: Option<String>, // base64 encoded
    pub element_info: Option<ElementInfo>,
    pub error: Option<String>,
    pub execution_time_ms: u64,
}

/// 元素信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ElementInfo {
    pub id: Option<String>,
    pub name: String,
    pub class: String,
    pub bounds: Rect,
    pub control_type: String,
    pub value: Option<String>,
    pub children_count: usize,
}

/// 矩形区域
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl GuiController {
    /// 创建新的 GUI 控制器
    pub async fn new() -> Result<Self, GuiError> {
        Ok(Self {
            capture: Arc::new(RwLock::new(capture::ScreenCapture::new()?)),
            uia: Arc::new(RwLock::new(uia::UiaAutomation::new()?)),
            vision: Arc::new(RwLock::new(vision::VisionProcessor::new()?)),
            input: Arc::new(RwLock::new(input::InputSimulator::new()?)),
        })
    }

    /// 执行 GUI 操作
    pub async fn execute(&self, action: GuiAction) -> Result<ActionResult, GuiError> {
        let start = std::time::Instant::now();
        
        // 1. 解析目标位置
        let target_coords = self.resolve_target(&action.target).await?;
        
        // 2. 执行动作
        let result = match action.action_type {
            ActionType::Click => {
                self.input.read().await.click(target_coords.0, target_coords.1).await?
            }
            ActionType::DoubleClick => {
                self.input.read().await.double_click(target_coords.0, target_coords.1).await?
            }
            ActionType::Type => {
                if let Some(text) = &action.params.text {
                    self.input.read().await.type_text(text).await?
                } else {
                    return Err(GuiError::InvalidParams("type action requires text".to_string()));
                }
            }
            ActionType::Screenshot => {
                self.capture.read().await.capture_fullscreen().await?
            }
            _ => return Err(GuiError::UnsupportedAction(format!("{:?}", action.action_type))),
        };
        
        // 3. 捕获结果截图
        let screenshot = self.capture.read().await.capture_fullscreen().await.ok()
            .map(|img| base64::encode(&img));
        
        let execution_time = start.elapsed().as_millis() as u64;
        
        Ok(ActionResult {
            success: true,
            screenshot,
            element_info: None,
            error: None,
            execution_time_ms: execution_time,
        })
    }

    /// 解析目标为坐标
    async fn resolve_target(&self, target: &Target) -> Result<(i32, i32), GuiError> {
        match target {
            Target::Coordinates { x, y } => Ok((*x, *y)),
            Target::Element { id, name, class } => {
                // 使用 UIA 查找元素
                self.uia.read().await.find_element(id.as_deref(), name.as_deref(), class.as_deref()).await
            }
            Target::Image { template, confidence } => {
                // 使用视觉匹配
                let screenshot = self.capture.read().await.capture_fullscreen().await?;
                self.vision.read().await.find_image_match(&screenshot, template, *confidence).await
            }
            Target::Text { content, partial } => {
                // OCR 查找文本
                let screenshot = self.capture.read().await.capture_fullscreen().await?;
                self.vision.read().await.find_text(&screenshot, content, *partial).await
            }
            Target::Description { desc } => {
                // LLM 引导的视觉定位
                let screenshot = self.capture.read().await.capture_fullscreen().await?;
                self.vision.read().await.locate_by_description(&screenshot, desc).await
            }
        }
    }

    /// 获取当前屏幕所有可交互元素
    pub async fn get_interactive_elements(&self) -> Result<Vec<ElementInfo>, GuiError> {
        self.uia.read().await.get_all_elements().await
    }

    /// 等待元素出现
    pub async fn wait_for_element(
        &self, 
        target: &Target, 
        timeout_ms: u64
    ) -> Result<ElementInfo, GuiError> {
        let start = std::time::Instant::now();
        
        while start.elapsed().as_millis() as u64 < timeout_ms {
            if let Ok(coords) = self.resolve_target(target).await {
                // 找到元素，获取详细信息
                return self.uia.read().await.get_element_at(coords.0, coords.1).await;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
        
        Err(GuiError::Timeout(format!("Element not found within {}ms", timeout_ms)))
    }
}

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
}

// Stub modules for compilation
mod base64 {
    pub fn encode<T: AsRef<[u8]>>(input: T) -> String {
        use std::fmt::Write;
        let mut result = String::new();
        for byte in input.as_ref() {
            write!(&mut result, "{:02x}", byte).unwrap();
        }
        result
    }
}
