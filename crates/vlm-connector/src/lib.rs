//! OpenOxygen Next - VLM (Vision-Language Model) Connector
//!
//! 对标 UI-TARS 的视觉理解能力
//! 支持多种视觉语言模型：GPT-4V, Claude 3, Gemini, Qwen-VL, LLaVA
//!
//! 当前后端：Ollama（`/api/chat`，支持本地视觉模型如 qwen3-vl、llava）。
//! 其他 provider（OpenAI/Anthropic/...）的视觉后端待接入，调用时会返回明确错误。

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use openoxygen_core::error::CoreError;
use openoxygen_core::runtime::{StepExecutor, StepResult};
use openoxygen_core::scheduler::{StepType, TaskStep};
use serde::{Deserialize, Serialize};

/// VLM 提供者
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum VlmProvider {
    OpenAi,
    Anthropic,
    Google,
    Alibaba,
    Meta,
    /// 本地 Ollama 服务（当前唯一已实现的视觉后端）
    Ollama,
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

impl VlmConfig {
    /// 便捷构造：本地 Ollama 视觉模型（默认 qwen3-vl:8b）
    pub fn ollama(model: impl Into<String>) -> Self {
        Self {
            provider: VlmProvider::Ollama,
            api_key: None,
            base_url: Some("http://localhost:11434".to_string()),
            model: model.into(),
            max_tokens: 4096,
            temperature: 0.0,
            timeout_secs: 120,
        }
    }

    /// 解析出有效的 base_url（Ollama 默认 localhost:11434）
    fn resolved_base_url(&self) -> String {
        self.base_url
            .clone()
            .unwrap_or_else(|| "http://localhost:11434".to_string())
            .trim_end_matches('/')
            .to_string()
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
    client: reqwest::Client,
}

impl VlmConnector {
    /// 创建新的 VLM 连接器
    pub fn new(config: VlmConfig) -> Result<Self, VlmError> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(config.timeout_secs))
            .build()
            .map_err(|err| VlmError::NetworkError(err.to_string()))?;
        Ok(Self { config, client })
    }

    /// 发送视觉请求。
    ///
    /// 当前仅实现 Ollama 后端（`/api/chat`，通过 `images` 字段正确传递 base64 截图）。
    /// 其他 provider 返回 `NotImplemented`，而非伪造响应。
    pub async fn ask(&self, request: &VisionRequest) -> Result<VisionResponse, VlmError> {
        match self.config.provider {
            VlmProvider::Ollama => self.ask_ollama(request).await,
            _ => Err(VlmError::NotImplemented),
        }
    }

    /// 根据截图预测下一步动作（UI-TARS 式：截图 + 任务 → 结构化动作）。
    pub async fn predict_action(
        &self,
        screenshot_base64: &str,
        task: &str,
    ) -> Result<PredictedAction, VlmError> {
        let request = VisionRequest {
            prompt: format!(
                "任务：{task}\n\n请分析当前截图，判断为完成该任务需要执行的下一步动作。"
            ),
            images: vec![ImageInput {
                data: ImageData::Base64(screenshot_base64.to_string()),
                description: Some("current screen".to_string()),
            }],
            system_prompt: Some(ACTION_SYSTEM_PROMPT.to_string()),
            response_format: ResponseFormat::Json,
            context: None,
        };

        let response = self.ask(&request).await?;
        parse_predicted_action(&response.content)
    }

    /// Ollama `/api/chat` 后端实现
    async fn ask_ollama(&self, request: &VisionRequest) -> Result<VisionResponse, VlmError> {
        let url = format!("{}/api/chat", self.config.resolved_base_url());
        let body = build_ollama_chat_body(&self.config, request)?;

        let response = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|err| VlmError::NetworkError(err.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let detail = response.text().await.unwrap_or_default();
            return Err(VlmError::ApiError(format!(
                "Ollama chat failed: {status} - {detail}"
            )));
        }

        let text = response
            .text()
            .await
            .map_err(|err| VlmError::NetworkError(err.to_string()))?;

        parse_ollama_chat_response(&text, &self.config.model)
    }
}

/// 引导 VLM 输出结构化动作 JSON 的系统提示
const ACTION_SYSTEM_PROMPT: &str = "You are a GUI automation agent. \
Analyze the screenshot and output the single next action as strict JSON. \
Respond with ONLY a JSON object, no prose, using this schema: \
{\"action_type\": \"click|type|scroll|wait|done\", \
\"target\": {\"x\": <int>, \"y\": <int>} | null, \
\"params\": { ... } | null, \
\"confidence\": <float 0..1>}";

/// 构造 Ollama `/api/chat` 请求体。
///
/// 关键点：图像必须放进 `messages[].images` 数组（base64，不含 data URI 前缀），
/// 而不是塞进 content 文本——后者视觉模型无法识别。
fn build_ollama_chat_body(
    config: &VlmConfig,
    request: &VisionRequest,
) -> Result<serde_json::Value, VlmError> {
    let mut messages = Vec::new();

    if let Some(system) = &request.system_prompt {
        messages.push(serde_json::json!({
            "role": "system",
            "content": system,
        }));
    }

    // 收集 base64 图像（Ollama 只接受 base64，URL 形式暂不支持）
    let mut images: Vec<String> = Vec::new();
    for image in &request.images {
        match &image.data {
            ImageData::Base64(data) => images.push(strip_data_uri_prefix(data).to_string()),
            ImageData::Url(_) => {
                return Err(VlmError::ImageError(
                    "Ollama backend only supports base64 images, not URLs".to_string(),
                ));
            }
        }
    }

    let mut user_message = serde_json::json!({
        "role": "user",
        "content": request.prompt,
    });
    if !images.is_empty() {
        user_message["images"] = serde_json::json!(images);
    }
    messages.push(user_message);

    let mut payload = serde_json::json!({
        "model": config.model,
        "messages": messages,
        "stream": false,
        "options": {
            "temperature": config.temperature,
            "num_predict": config.max_tokens,
        },
    });

    if matches!(request.response_format, ResponseFormat::Json) {
        payload["format"] = serde_json::json!("json");
    }

    Ok(payload)
}

/// 去掉 `data:image/...;base64,` 前缀，只保留裸 base64
fn strip_data_uri_prefix(data: &str) -> &str {
    data.rfind(";base64,")
        .map(|idx| &data[idx + ";base64,".len()..])
        .unwrap_or(data)
}

/// 解析 Ollama `/api/chat` 的非流式响应
fn parse_ollama_chat_response(text: &str, fallback_model: &str) -> Result<VisionResponse, VlmError> {
    let value: serde_json::Value = serde_json::from_str(text)
        .map_err(|err| VlmError::ParseError(format!("invalid Ollama response: {err}")))?;

    let content = value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .ok_or_else(|| VlmError::ParseError("missing message.content".to_string()))?
        .to_string();

    let model = value
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or(fallback_model)
        .to_string();

    let usage = match (
        value.get("prompt_eval_count").and_then(|v| v.as_u64()),
        value.get("eval_count").and_then(|v| v.as_u64()),
    ) {
        (Some(prompt), Some(completion)) => Some(UsageInfo {
            prompt_tokens: prompt as u32,
            completion_tokens: completion as u32,
            total_tokens: (prompt + completion) as u32,
        }),
        _ => None,
    };

    Ok(VisionResponse {
        content,
        model,
        usage,
    })
}

/// 从 VLM 文本输出中解析出 `PredictedAction`。
///
/// 容错处理：模型可能用 ```json 代码块包裹，或在 JSON 前后夹带说明文字，
/// 因此提取第一个平衡的 JSON 对象再反序列化。
fn parse_predicted_action(content: &str) -> Result<PredictedAction, VlmError> {
    let json_slice = extract_json_object(content)
        .ok_or_else(|| VlmError::ParseError("no JSON object found in response".to_string()))?;

    let value: serde_json::Value = serde_json::from_str(json_slice)
        .map_err(|err| VlmError::ParseError(format!("invalid action JSON: {err}")))?;

    let action_type = value
        .get("action_type")
        .and_then(|v| v.as_str())
        .ok_or_else(|| VlmError::ParseError("missing action_type".to_string()))?
        .to_string();

    let confidence = value
        .get("confidence")
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(0.0) as f32;

    Ok(PredictedAction {
        action_type,
        target: value.get("target").cloned().unwrap_or(serde_json::Value::Null),
        params: value.get("params").cloned().unwrap_or(serde_json::Value::Null),
        confidence,
    })
}

/// 提取字符串中第一个平衡的 `{...}` JSON 对象（忽略字符串字面量内的花括号）
fn extract_json_object(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let bytes = text.as_bytes();
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (offset, &byte) in bytes[start..].iter().enumerate() {
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            continue;
        }

        match byte {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&text[start..=start + offset]);
                }
            }
            _ => {}
        }
    }

    None
}

impl StepExecutor for VlmConnector {
    fn execute_step<'a>(
        &'a self,
        step: &'a TaskStep,
    ) -> Pin<Box<dyn Future<Output = Result<StepResult, CoreError>> + Send + 'a>> {
        Box::pin(async move {
            let StepType::LlmInference { prompt, model } = &step.step_type else {
                return Err(CoreError::SchedulerError(format!(
                    "VlmConnector cannot execute step type: {:?}",
                    step.step_type
                )));
            };

            let request = VisionRequest {
                prompt: prompt.clone(),
                images: Vec::new(),
                system_prompt: step
                    .params
                    .get("system_prompt")
                    .and_then(serde_json::Value::as_str)
                    .map(ToString::to_string),
                response_format: step
                    .params
                    .get("response_format")
                    .cloned()
                    .map(serde_json::from_value)
                    .transpose()?
                    .unwrap_or(ResponseFormat::Text),
                context: step.params.get("context").cloned(),
            };

            // 调度链路：纯文本 LLM 步骤派发。若当前 provider 尚无真实后端
            // （非 Ollama），降级为明确标注的占位响应，保证任务图能跑完，
            // 而不是让整条调度失败。真实视觉调用请走 ask()/predict_action()。
            let response = match self.ask(&request).await {
                Ok(resp) => resp,
                Err(VlmError::NotImplemented) => VisionResponse {
                    content: format!("[placeholder: no VLM backend configured] {prompt}"),
                    model: self.config.model.clone(),
                    usage: None,
                },
                Err(err) => return Err(CoreError::SchedulerError(err.to_string())),
            };

            Ok(StepResult::success(serde_json::json!({
                "content": response.content,
                "model": model.clone().unwrap_or(response.model),
                "usage": response.usage
            })))
        })
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use openoxygen_core::runtime::StepExecutorDispatcher;
    use openoxygen_core::scheduler::{Task, TaskPriority, TaskStatus};
    use openoxygen_core::CoreRuntime;
    use std::collections::HashMap;
    use std::sync::Arc;

    fn llm_step() -> TaskStep {
        TaskStep {
            id: "llm".to_string(),
            step_type: StepType::LlmInference {
                prompt: "Hello OpenOxygen".to_string(),
                model: Some("stub-llm".to_string()),
            },
            params: serde_json::Value::Null,
            depends_on: Vec::new(),
        }
    }

    #[test]
    fn strips_data_uri_prefix() {
        assert_eq!(strip_data_uri_prefix("data:image/png;base64,AAAA"), "AAAA");
        assert_eq!(strip_data_uri_prefix("BBBB"), "BBBB");
    }

    #[test]
    fn builds_ollama_body_with_images_in_correct_field() {
        let config = VlmConfig::ollama("qwen3-vl:8b");
        let request = VisionRequest {
            prompt: "what is on screen?".to_string(),
            images: vec![ImageInput {
                data: ImageData::Base64("data:image/png;base64,ZZZZ".to_string()),
                description: None,
            }],
            system_prompt: Some("be concise".to_string()),
            response_format: ResponseFormat::Json,
            context: None,
        };

        let body = build_ollama_chat_body(&config, &request).expect("build body");

        assert_eq!(body["model"], "qwen3-vl:8b");
        assert_eq!(body["stream"], false);
        assert_eq!(body["format"], "json");

        let messages = body["messages"].as_array().expect("messages array");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[1]["role"], "user");
        // 图像必须在 images 字段（裸 base64，去掉 data URI 前缀），不在 content
        assert_eq!(messages[1]["images"][0], "ZZZZ");
        assert_eq!(messages[1]["content"], "what is on screen?");
    }

    #[test]
    fn ollama_body_rejects_url_images() {
        let config = VlmConfig::ollama("llava");
        let request = VisionRequest {
            prompt: "x".to_string(),
            images: vec![ImageInput {
                data: ImageData::Url("http://example.com/x.png".to_string()),
                description: None,
            }],
            system_prompt: None,
            response_format: ResponseFormat::Text,
            context: None,
        };

        assert!(matches!(
            build_ollama_chat_body(&config, &request),
            Err(VlmError::ImageError(_))
        ));
    }

    #[test]
    fn parses_ollama_chat_response() {
        let raw = r#"{
            "model": "qwen3-vl:8b",
            "message": {"role": "assistant", "content": "hello there"},
            "done": true,
            "prompt_eval_count": 12,
            "eval_count": 8
        }"#;

        let response = parse_ollama_chat_response(raw, "fallback").expect("parse");
        assert_eq!(response.content, "hello there");
        assert_eq!(response.model, "qwen3-vl:8b");
        let usage = response.usage.expect("usage");
        assert_eq!(usage.prompt_tokens, 12);
        assert_eq!(usage.completion_tokens, 8);
        assert_eq!(usage.total_tokens, 20);
    }

    #[test]
    fn parses_predicted_action_from_plain_json() {
        let content = r#"{"action_type": "click", "target": {"x": 100, "y": 200}, "params": null, "confidence": 0.9}"#;
        let action = parse_predicted_action(content).expect("parse action");
        assert_eq!(action.action_type, "click");
        assert_eq!(action.target["x"], 100);
        assert_eq!(action.target["y"], 200);
        assert!((action.confidence - 0.9).abs() < f32::EPSILON);
    }

    #[test]
    fn parses_predicted_action_wrapped_in_code_fence() {
        let content = "Here is the action:\n```json\n{\"action_type\": \"type\", \"target\": null, \"params\": {\"text\": \"hi\"}, \"confidence\": 0.7}\n```\nDone.";
        let action = parse_predicted_action(content).expect("parse action");
        assert_eq!(action.action_type, "type");
        assert_eq!(action.params["text"], "hi");
    }

    #[test]
    fn extract_json_ignores_braces_inside_strings() {
        let content = r#"prefix {"msg": "a } b { c", "n": 1} suffix"#;
        let extracted = extract_json_object(content).expect("extract");
        let value: serde_json::Value = serde_json::from_str(extracted).expect("valid json");
        assert_eq!(value["msg"], "a } b { c");
        assert_eq!(value["n"], 1);
    }

    #[test]
    fn ask_rejects_unimplemented_provider() {
        let connector = VlmConnector::new(VlmConfig::default()).expect("create connector");
        let request = VisionRequest {
            prompt: "x".to_string(),
            images: Vec::new(),
            system_prompt: None,
            response_format: ResponseFormat::Text,
            context: None,
        };
        let result = tokio_test::block_on(connector.ask(&request));
        assert!(matches!(result, Err(VlmError::NotImplemented)));
    }

    #[tokio::test]
    async fn vlm_connector_executes_llm_step() {
        let connector = VlmConnector::new(VlmConfig::default()).expect("create connector");
        let result = connector
            .execute_step(&llm_step())
            .await
            .expect("execute llm step");

        assert!(result.success);
        assert_eq!(result.output["model"], "stub-llm");
        assert!(result.output["content"]
            .as_str()
            .unwrap()
            .contains("Hello OpenOxygen"));
    }

    #[tokio::test]
    async fn runtime_dispatches_llm_step_to_completion() {
        let llm = Arc::new(VlmConnector::new(VlmConfig::default()).expect("create connector"));
        let dispatcher = Arc::new(StepExecutorDispatcher::new().with_llm_executor(llm));
        let runtime = CoreRuntime::with_step_executor(dispatcher)
            .await
            .expect("create runtime");

        runtime.start().await.expect("start runtime");

        let task_id = "llm-e2e".to_string();
        let task = Task {
            id: task_id.clone(),
            name: "LLM E2E".to_string(),
            description: "Run an LLM inference step through CoreRuntime".to_string(),
            priority: TaskPriority::Normal,
            steps: vec![llm_step()],
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
