//! OpenOxygen Next - VLM (Vision-Language Model) Connector
//! 
//! 对标 UI-TARS 的视觉理解能力
//! 支持多种视觉语言模型：GPT-4V, Claude 3, Gemini, Qwen-VL, LLaVA

use std::collections::HashMap;
use image::DynamicImage;
use serde::{Deserialize, Serialize};

pub mod providers;
pub mod prompting;

/// VLM 提供者
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum VlmProvider {
    OpenAi,      // GPT-4V, GPT-4o
    Anthropic,   // Claude 3
    Google,      // Gemini
    Alibaba,     // Qwen-VL
    Local,       // LLaVA, BakLLaVA
    Custom(String),
}

/// VLM 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VlmConfig {
    pub provider: VlmProvider,
    pub api_key: String,
    pub base_url: Option<String>,
    pub model: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub timeout_ms: u64,
}

impl Default for VlmConfig {
    fn default() -> Self {
        Self {
            provider: VlmProvider::OpenAi,
            api_key: String::new(),
            base_url: None,
            model: "gpt-4o".to_string(),
            temperature: 0.7,
            max_tokens: 4096,
            timeout_ms: 30000,
        }
    }
}

/// 视觉请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VisionRequest {
    pub prompt: String,
    pub images: Vec<ImageInput>,
    pub system_prompt: Option<String>,
    pub response_format: ResponseFormat,
    pub context: Option<VisionContext>,
}

/// 图像输入
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageInput {
    pub data: ImageData,
    pub description: Option<String>,
}

/// 图像数据
#[derive(Debug, Clone)]
pub enum ImageData {
    Base64(String),
    Path(std::path::PathBuf),
    Image(DynamicImage),
    Url(String),
}

impl Serialize for ImageData {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            ImageData::Base64(s) | ImageData::Url(s) => serializer.serialize_str(s),
            ImageData::Path(p) => serializer.serialize_str(&p.to_string_lossy()),
            ImageData::Image(_) => serializer.serialize_str("[image]"),
        }
    }
}

impl<'de> Deserialize<'de> for ImageData {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        if s.starts_with("http") {
            Ok(ImageData::Url(s))
        } else if s.len() > 100 {
            Ok(ImageData::Base64(s))
        } else {
            Ok(ImageData::Path(std::path::PathBuf::from(s)))
        }
    }
}

/// 响应格式
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ResponseFormat {
    #[default]
    Text,
    Json,
    Structured(Box<serde_json::Value>),
}

/// 视觉上下文
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VisionContext {
    pub previous_screenshots: Vec<String>,
    pub task_description: String,
    pub current_step: usize,
    pub total_steps: usize,
}

/// 视觉响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VisionResponse {
    pub content: String,
    pub structured_output: Option<serde_json::Value>,
    pub reasoning: Option<String>,
    pub usage: TokenUsage,
    pub model: String,
    pub latency_ms: u64,
}

/// Token 使用
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TokenUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

/// UI 理解请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiUnderstandingRequest {
    pub screenshot: ImageInput,
    pub task: String,
    pub previous_actions: Vec<PreviousAction>,
    pub interactive_elements: Vec<UiElement>,
    pub output_format: UiOutputFormat,
}

/// 之前的动作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreviousAction {
    pub action: String,
    pub target: String,
    pub result: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

/// UI 元素
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiElement {
    pub id: String,
    pub element_type: String,
    pub location: ElementLocation,
    pub content: Option<String>,
    pub attributes: HashMap<String, String>,
}

/// 元素位置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ElementLocation {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub confidence: f32,
}

/// UI 输出格式
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UiOutputFormat {
    Action,           // 直接返回动作
    ElementList,      // 返回元素列表
    Plan,             // 返回执行计划
    NaturalLanguage,  // 自然语言描述
}

/// UI 理解响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiUnderstandingResponse {
    pub predicted_action: Option<PredictedAction>,
    pub thought_process: String,
    pub elements_recognized: Vec<UiElement>,
    pub plan: Option<Vec<String>>,
    pub is_task_complete: bool,
    pub confidence: f32,
}

/// 预测动作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PredictedAction {
    pub action_type: ActionType,
    pub target: Option<ElementTarget>,
    pub params: HashMap<String, serde_json::Value>,
    pub reason: String,
}

/// 动作类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionType {
    Click,
    DoubleClick,
    RightClick,
    Type,
    KeyPress,
    Scroll,
    Drag,
    Hover,
    Wait,
    Screenshot,
    Navigate,
    Back,
    None,
}

/// 元素目标
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ElementTarget {
    #[serde(rename = "id")]
    Id { id: String },
    #[serde(rename = "coordinates")]
    Coordinates { x: i32, y: i32 },
    #[serde(rename = "description")]
    Description { text: String },
    #[serde(rename = "element_ref")]
    ElementRef { ref_id: String },
}

/// VLM 连接器
pub struct VlmConnector {
    config: VlmConfig,
    client: reqwest::Client,
}

impl VlmConnector {
    /// 创建新的 VLM 连接器
    pub fn new(config: VlmConfig) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(config.timeout_ms))
            .build()
            .expect("Failed to build HTTP client");
        
        Self { config, client }
    }

    /// 视觉问答
    pub async fn ask(&self, request: VisionRequest) -> Result<VisionResponse, VlmError> {
        let start = std::time::Instant::now();
        
        let response = match self.config.provider {
            VlmProvider::OpenAi => self.call_openai(&request).await?,
            VlmProvider::Anthropic => self.call_anthropic(&request).await?,
            VlmProvider::Google => self.call_google(&request).await?,
            VlmProvider::Alibaba => self.call_alibaba(&request).await?,
            VlmProvider::Local => self.call_local(&request).await?,
            VlmProvider::Custom(_) => self.call_custom(&request).await?,
        };
        
        let latency_ms = start.elapsed().as_millis() as u64;
        
        Ok(VisionResponse {
            content: response.content,
            structured_output: response.structured_output,
            reasoning: response.reasoning,
            usage: response.usage,
            model: self.config.model.clone(),
            latency_ms,
        })
    }

    /// UI 理解
    pub async fn understand_ui(
        &self,
        request: UiUnderstandingRequest,
    ) -> Result<UiUnderstandingResponse, VlmError> {
        // 构建 UI 理解的 prompt
        let prompt = self.build_ui_prompt(&request);
        
        let vision_request = VisionRequest {
            prompt,
            images: vec![request.screenshot],
            system_prompt: Some(self.get_ui_system_prompt()),
            response_format: ResponseFormat::Json,
            context: None,
        };
        
        let response = self.ask(vision_request).await?;
        
        // 解析 JSON 响应
        let structured: UiUnderstandingResponse = serde_json::from_str(&response.content)
            .or_else(|_| {
                // 尝试从 markdown 代码块中提取
                Self::extract_json_from_markdown(&response.content)
            })?;
        
        Ok(structured)
    }

    /// 定位元素
    pub async fn locate_element(
        &self,
        screenshot: &DynamicImage,
        description: &str,
    ) -> Result<(i32, i32), VlmError> {
        // 将图像转为 base64
        let mut buffer = Vec::new();
        screenshot.write_to(&mut std::io::Cursor::new(&mut buffer), image::ImageFormat::Png)
            .map_err(|e| VlmError::ImageError(e.to_string()))?;
        let base64 = base64::encode(&buffer);
        
        let prompt = format!(
            r#"Locate the UI element described as "{}" in this screenshot.
            Respond with JSON: {{"x": number, "y": number, "confidence": number}}"#,
            description
        );
        
        let request = VisionRequest {
            prompt,
            images: vec![ImageInput {
                data: ImageData::Base64(format!("data:image/png;base64,{}, base64)),
                description: None,
            }],
            system_prompt: None,
            response_format: ResponseFormat::Json,
            context: None,
        };
        
        let response = self.ask(request).await?;
        
        let location: serde_json::Value = serde_json::from_str(&response.content)?;
        let x = location["x"].as_i64().ok_or(VlmError::ParseError)? as i32;
        let y = location["y"].as_i64().ok_or(VlmError::ParseError)? as i32;
        
        Ok((x, y))
    }

    /// 动作预测（UI-TARS 风格）
    pub async fn predict_action(
        &self,
        screenshot: &DynamicImage,
        task: &str,
        history: &[PreviousAction],
    ) -> Result<PredictedAction, VlmError> {
        let mut buffer = Vec::new();
        screenshot.write_to(&mut std::io::Cursor::new(&mut buffer), image::ImageFormat::Png)
            .map_err(|e| VlmError::ImageError(e.to_string()))?;
        let base64 = base64::encode(&buffer);
        
        let history_str = history.iter()
            .map(|a| format!("- {} on {}: {}", a.action, a.target, a.result))
            .collect::<Vec<_>>()
            .join("\n");
        
        let prompt = format!(
            r#"You are an AI assistant helping to control a computer. 
            Task: {}
            
            Previous actions:
            {}
            
            Given the current screenshot, what action should be taken next?
            
            Respond with JSON:
            {{
                "action_type": "click|type|scroll|wait|...",
                "target": {{"type": "coordinates|description", ...}},
                "params": {{}},
                "reason": "explanation"
            }}"#,
            task, history_str
        );
        
        let request = VisionRequest {
            prompt,
            images: vec![ImageInput {
                data: ImageData::Base64(format!("data:image/png;base64,{}, base64)),
                description: Some("Current screen".to_string()),
            }],
            system_prompt: Some(
                "You are a helpful computer automation assistant. \
                 Analyze the screenshot and predict the next action to complete the task. \
                     Be precise with coordinates and actions.".to_string()
            ),
            response_format: ResponseFormat::Json,
            context: None,
        };
        
        let response = self.ask(request).await?;
        let action: PredictedAction = serde_json::from_str(&response.content)?;
        
        Ok(action)
    }

    /// 调用 OpenAI
    async fn call_openai(&self, request: &VisionRequest) -> Result<VisionResponse, VlmError> {
        // OpenAI API 实现
        let url = format!("{}/v1/chat/completions", 
            self.config.base_url.as_deref().unwrap_or("https://api.openai.com"));
        
        let messages = vec![
            serde_json::json!({
                "role": "system",
                "content": request.system_prompt.as_deref().unwrap_or("")            }),
            serde_json::json!({
                "role": "user",
                "content": self.build_content_with_images(request)
            })
        ];
        
        let body = serde_json::json!({
            "model": self.config.model,
            "messages": messages,
            "temperature": self.config.temperature,
            "max_tokens": self.config.max_tokens,
            "response_format": if matches!(request.response_format, ResponseFormat::Json) {
                serde_json::json!({"type": "json_object"})
            } else {
                serde_json::Value::Null
            }
        });
        
        let response = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.config.api_key))
            .json(&body)
            .send()
            .await?;
        
        if !response.status().is_success() {
            let error = response.text().await?;
            return Err(VlmError::ApiError(error));
        }
        
        let result: serde_json::Value = response.json().await?;
        let choice = &result["choices"][0];
        
        Ok(VisionResponse {
            content: choice["message"]["content"].as_str().unwrap_or("").to_string(),
            structured_output: None,
            reasoning: None,
            usage: TokenUsage {
                prompt_tokens: result["usage"]["prompt_tokens"].as_u64().unwrap_or(0) as u32,
                completion_tokens: result["usage"]["completion_tokens"].as_u64().unwrap_or(0) as u32,
                total_tokens: result["usage"]["total_tokens"].as_u64().unwrap_or(0) as u32,
            },
            model: result["model"].as_str().unwrap_or(&self.config.model).to_string(),
            latency_ms: 0,
        })
    }

    /// 调用 Anthropic
    async fn call_anthropic(&self, request: &VisionRequest) -> Result<VisionResponse, VlmError> {
        // Claude API 实现
        let url = format!("{}/v1/messages",
            self.config.base_url.as_deref().unwrap_or("https://api.anthropic.com"));
        
        let body = serde_json::json!({
            "model": self.config.model,
            "messages": [{
                "role": "user",
                "content": self.build_content_with_images(request)
            }],
            "system": request.system_prompt.as_deref().unwrap_or(""),
            "max_tokens": self.config.max_tokens,
            "temperature": self.config.temperature,
        });
        
        let response = self.client
            .post(&url)
            .header("x-api-key", &self.config.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await?;
        
        if !response.status().is_success() {
            return Err(VlmError::ApiError(response.text().await?));
        }
        
        let result: serde_json::Value = response.json().await?;
        
        Ok(VisionResponse {
            content: result["content"][0]["text"].as_str().unwrap_or("").to_string(),
            structured_output: None,
            reasoning: None,
            usage: TokenUsage {
                prompt_tokens: result["usage"]["input_tokens"].as_u64().unwrap_or(0) as u32,
                completion_tokens: result["usage"]["output_tokens"].as_u64().unwrap_or(0) as u32,
                total_tokens: 0,
            },
            model: result["model"].as_str().unwrap_or(&self.config.model).to_string(),
            latency_ms: 0,
        })
    }

    /// 调用 Google
    async fn call_google(&self, _request: &VisionRequest) -> Result<VisionResponse, VlmError> {
        todo!("Google Gemini implementation")
    }

    /// 调用 Alibaba
    async fn call_alibaba(&self, _request: &VisionRequest) -> Result<VisionResponse, VlmError> {
        todo!("Alibaba Qwen-VL implementation")
    }

    /// 调用本地模型
    async fn call_local(&self, _request: &VisionRequest) -> Result<VisionResponse, VlmError> {
        todo!("Local LLaVA implementation")
    }

    /// 调用自定义提供商
    async fn call_custom(&self, _request: &VisionRequest) -> Result<VisionResponse, VlmError> {
        todo!("Custom provider implementation")
    }

    /// 构建带图像的内容
    fn build_content_with_images(&self, request: &VisionRequest) -> Vec<serde_json::Value> {
        let mut content = vec![serde_json::json!({
            "type": "text",
            "text": request.prompt
        })];
        
        for image in &request.images {
            let image_url = match &image.data {
                ImageData::Base64(b64) => b64.clone(),
                ImageData::Path(path) => {
                    // 读取文件并转为 base64
                    let bytes = std::fs::read(path).unwrap_or_default();
                    format!("data:image/png;base64,{}, base64::encode(&bytes))
                }
                ImageData::Image(img) => {
                    let mut buffer = Vec::new();
                    img.write_to(&mut std::io::Cursor::new(&mut buffer), image::ImageFormat::Png).ok();
                    format!("data:image/png;base64,{}, base64::encode(&buffer))
                }
                ImageData::Url(url) => url.clone(),
            };
            
            content.push(serde_json::json!({
                "type": "image_url",
                "image_url": { "url": image_url }
            }));
        }
        
        content
    }

    /// 构建 UI prompt
    fn build_ui_prompt(&self, request: &UiUnderstandingRequest) -> String {
        format!(
            r#"You are analyzing a computer screen to help complete a task.
            
Task: {}
Previous actions: {:?}
Interactive elements: {:?}

Analyze the screenshot and provide:
1. Your understanding of the current state
2. The next action to take
3. Confidence level (0-1)
4. Whether the task is complete

Respond in the requested format."#,
            request.task,
            request.previous_actions,
            request.interactive_elements
        )
    }

    /// 获取 UI 系统 prompt
    fn get_ui_system_prompt(&self) -> String {
        r#"You are an expert computer automation assistant with strong visual understanding.

Your job is to:
1. Analyze the current state of the computer screen
2. Understand the task progress
3. Determine the next logical action
4. Provide precise coordinates when clicking is needed

Guidelines:
- Be precise with element locations (provide exact coordinates)
- If an element is not visible, say so clearly
- If the task appears complete, indicate completion
- Consider previous actions to avoid repetition
- Use natural, efficient action sequences"#.to_string()
    }

    /// 从 markdown 提取 JSON
    fn extract_json_from_markdown(text: &str) -> Result<UiUnderstandingResponse, VlmError> {
        if let Some(start) = text.find("```json") {
            let start = start + 7;
            if let Some(end) = text[start..].find("```") {
                let json_str = text[start..start + end].trim();
                return serde_json::from_str(json_str)
                    .map_err(|e| VlmError::ParseErrorWithContext(e.to_string()));
            }
        }
        
        // 尝试直接解析
        serde_json::from_str(text)
            .map_err(|e| VlmError::ParseErrorWithContext(e.to_string()))
    }
}

/// VLM 错误
#[derive(Debug, thiserror::Error)]
pub enum VlmError {
    #[error("API error: {0}")]
    ApiError(String),
    
    #[error("Network error: {0}")]
    NetworkError(#[from] reqwest::Error),
    
    #[error("Parse error")]
    ParseError,
    
    #[error("Parse error: {0}")]
    ParseErrorWithContext(String),
    
    #[error("Image error: {0}")]
    ImageError(String),
    
    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),
}

// Base64 工具
mod base64 {
    pub fn encode<T: AsRef<[u8]>>(input: T) -> String {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(input.as_ref())
    }
}

// Stub modules
pub mod providers {
    //! VLM 提供商实现
}

pub mod prompting {
    //! Prompt 模板管理
}
