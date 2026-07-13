//! OpenOxygen Next - VLM (Vision-Language Model) Connector
//!
//! 对标 UI-TARS 的视觉理解能力
//! 支持多种视觉语言模型：GPT-4V, Claude 3, Gemini, Qwen-VL, LLaVA
//! 当前为 stub 实现

use std::future::Future;
use std::pin::Pin;

use openoxygen_core::error::CoreError;
use openoxygen_core::runtime::{StepExecutor, StepResult};
use openoxygen_core::scheduler::{StepType, TaskStep};
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
    pub async fn ask(&self, request: &VisionRequest) -> Result<VisionResponse, VlmError> {
        Ok(VisionResponse {
            content: format!("stub response: {}", request.prompt),
            model: self.config.model.clone(),
            usage: None,
        })
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

            let response = self
                .ask(&request)
                .await
                .map_err(|err| CoreError::SchedulerError(err.to_string()))?;

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
