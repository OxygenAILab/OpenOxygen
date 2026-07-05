//! OpenOxygen Next - VLM (Vision-Language Model) Connector
//!
//! 对标 UI-TARS 的视觉理解能力
//! 支持多种视觉语言模型：GPT-4V, Claude 3, Gemini, Qwen-VL, LLaVA
//! 当前为 stub 实现

use serde::{Deserialize, Serialize};

// 内联 stub 模块定义在文件底部（providers, prompting）

/// VLM 提供者
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum VlmProvider {
    OpenAi,
    Anthropic,
    Google,
    Alibaba,
    Meta,
    OpenSource(String),
}

/// VLM 配置
#[derive(Debug, Clone)]
pub struct VlmConfig {
    pub provider: VlmProvider,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: String,
    pub max_tokens: u32,
    pub temperature: f32,
    pub timeout_secs: u64,
}

impl Default for VlmConfig {
    fn default() -> Self {
        Self {
            provider: VlmProvider::OpenAi,
            api_key: None,
            base_url: None,
            model: "gpt-4o".to_string(),
            max_tokens: 4096,
            temperature: 0.0,
            timeout_secs: 60,
        }
    }
}

/// 图像输入
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageInput {
    pub data: ImageData,
    pub description: Option<String>,
}

/// 图像数据
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ImageData {
    Base64(String),
    Url(String),
}

/// 视觉请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VisionRequest {
    pub prompt: String,
    pub images: Vec<ImageInput>,
    pub system_prompt: Option<String>,
    pub response_format: ResponseFormat,
    pub context: Option<serde_json::Value>,
}

/// 响应格式
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResponseFormat {
    Json,
    Text,
    Markdown,
}

/// 视觉响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VisionResponse {
    pub content: String,
    pub model: String,
    pub usage: Option<UsageInfo>,
}

/// Token 使用信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageInfo {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

/// 预测动作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PredictedAction {
    pub action_type: String,
    pub target: serde_json::Value,
    pub params: serde_json::Value,
    pub confidence: f32,
}

/// VLM 连接器
pub struct VlmConnector {
    config: VlmConfig,
}

impl VlmConnector {
    /// 创建新的 VLM 连接器
    pub fn new(config: VlmConfig) -> Result<Self, VlmError> {
        Ok(Self { config })
    }

    /// 发送视觉请求
    pub async fn ask(&self, _request: &VisionRequest) -> Result<VisionResponse, VlmError> {
        Err(VlmError::ApiError(
            "VLM connector not yet implemented (stub)".to_string(),
        ))
    }

    /// 根据截图预测下一步动作
    pub async fn predict_action(
        &self,
        _screenshot_base64: &str,
        _task: &str,
    ) -> Result<PredictedAction, VlmError> {
        Err(VlmError::ApiError(
            "predict_action not yet implemented (stub)".to_string(),
        ))
    }
}

/// VLM 错误
#[derive(Debug, thiserror::Error)]
pub enum VlmError {
    #[error("API error: {0}")]
    ApiError(String),

    #[error("Network error: {0}")]
    NetworkError(String),

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Image error: {0}")]
    ImageError(String),

    #[error("Serialization error: {0}")]
    SerializationError(String),

    #[error("Not implemented")]
    NotImplemented,
}

// Stub modules
pub mod providers {
    //! VLM 提供商实现（stub）
}

pub mod prompting {
    //! Prompt 模板管理（stub）
}
