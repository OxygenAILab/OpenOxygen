//! OpenOxygen Next - Ollama Integration
//! 
//! 本地模型管理，支持模型拉取和推理

use std::sync::Arc;
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Ollama 配置
#[derive(Debug, Clone)]
pub struct OllamaConfig {
    pub base_url: String,
    pub default_model: String,
    pub auto_pull: bool,
    pub timeout_secs: u64,
}

impl Default for OllamaConfig {
    fn default() -> Self {
        Self {
            base_url: "http://localhost:11434".to_string(),
            default_model: "llama2".to_string(),
            auto_pull: true,
            timeout_secs: 120,
        }
    }
}

/// Ollama 模型信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaModel {
    pub name: String,
    pub size: u64,
    pub parameter_size: String,
    pub quantization_level: String,
    pub family: String,
    pub format: String,
    pub modified_at: String,
    pub digest: String,
    pub details: ModelDetails,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDetails {
    pub parent_model: String,
    pub format: String,
    pub family: String,
    pub families: Vec<String>,
    pub parameter_size: String,
    pub quantization_level: String,
}

/// Ollama 生成请求
#[derive(Debug, Clone, Serialize)]
pub struct GenerateRequest {
    pub model: String,
    pub prompt: String,
    pub system: Option<String>,
    pub template: Option<String>,
    pub context: Option<Vec<i32>>,
    pub stream: bool,
    pub options: Option<GenerateOptions>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct GenerateOptions {
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub top_k: Option<i32>,
    pub max_tokens: Option<i32>,
    pub seed: Option<i32>,
    pub stop: Option<Vec<String>>,
}

/// Ollama 生成响应
#[derive(Debug, Clone, Deserialize)]
pub struct GenerateResponse {
    pub model: String,
    pub created_at: String,
    pub response: String,
    pub done: bool,
    pub context: Option<Vec<i32>>,
    pub total_duration: Option<u64>,
    pub load_duration: Option<u64>,
    pub prompt_eval_count: Option<i32>,
    pub prompt_eval_duration: Option<u64>,
    pub eval_count: Option<i32>,
    pub eval_duration: Option<u64>,
}

/// Ollama 拉取请求
#[derive(Debug, Clone, Serialize)]
pub struct PullRequest {
    pub name: String,
    pub insecure: Option<bool>,
    pub stream: bool,
}

/// Ollama 拉取响应
#[derive(Debug, Clone, Deserialize)]
pub struct PullResponse {
    pub status: String,
    pub digest: Option<String>,
    pub total: Option<u64>,
    pub completed: Option<u64>,
}

/// Ollama 管理器
pub struct OllamaManager {
    config: OllamaConfig,
    client: reqwest::Client,
    model_cache: Arc<RwLock<Vec<OllamaModel>>>,
}

impl OllamaManager {
    /// 创建新的 Ollama 管理器
    pub fn new(config: OllamaConfig) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(config.timeout_secs))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            config,
            client,
            model_cache: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// 检查 Ollama 服务是否可用
    pub async fn health_check(&self) -> Result<bool, OllamaError> {
        let response = self.client
            .get(format!("{}/api/tags", self.config.base_url))
            .send()
            .await?;

        Ok(response.status().is_success())
    }

    /// 获取已安装的模型列表
    pub async fn list_models(&self) -> Result<Vec<OllamaModel>, OllamaError> {
        let response = self.client
            .get(format!("{}/api/tags", self.config.base_url))
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(OllamaError::ApiError(format!(
                "Failed to list models: {}",
                response.status()
            )));
        }

        let tags_response: TagsResponse = response.json().await?;

        let models = tags_response.models.into_iter().map(|m| {
            OllamaModel {
                name: m.name,
                size: m.size,
                parameter_size: m.details.parameter_size,
                quantization_level: m.details.quantization_level,
                family: m.details.family,
                format: m.details.format,
                modified_at: m.modified_at,
                digest: m.digest,
                details: ModelDetails {
                    parent_model: m.details.parent_model,
                    format: m.details.format,
                    family: m.details.family,
                    families: m.details.families,
                    parameter_size: m.details.parameter_size,
                    quantization_level: m.details.quantization_level,
                },
            }
        }).collect();

        // 更新缓存
        *self.model_cache.write().await = models.clone();

        Ok(models)
    }

    /// 检查模型是否已安装
    pub async fn has_model(&self, name: &str) -> Result<bool, OllamaError> {
        let models = self.list_models().await?;
        Ok(models.iter().any(|m| m.name == name || m.name.starts_with(name)))
    }

    /// 拉取模型
    pub async fn pull_model(&self, name: &str) -> Result<(), OllamaError> {
        println!("Pulling model: {}", name);

        let request = PullRequest {
            name: name.to_string(),
            insecure: Some(false),
            stream: true,
        };

        let response = self.client
            .post(format!("{}/api/pull", self.config.base_url))
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(OllamaError::ApiError(format!(
                "Failed to pull model: {}",
                response.status()
            )));
        }

        // 处理流式响应
        let mut stream = response.bytes_stream();
        use futures::stream::StreamExt;

        while let Some(chunk) = stream.next().await {
            let data = chunk?;
            let text = String::from_utf8_lossy(&data);
            
            for line in text.lines() {
                if let Ok(pull_resp) = serde_json::from_str::<PullResponse>(line) {
                    match pull_resp.status.as_str() {
                        "pulling manifest" => println!("Pulling manifest..."),
                        "downloading" => {
                            if let (Some(total), Some(completed)) = (pull_resp.total, pull_resp.completed) {
                                let progress = (completed as f64 / total as f64) * 100.0;
                                println!("Downloading: {:.1}%", progress);
                            }
                        }
                        "verifying" => println!("Verifying..."),
                        "writing" => println!("Writing..."),
                        "success" => println!("Model {} pulled successfully!", name),
                        _ => {}
                    }
                }
            }
        }

        // 刷新缓存
        let _ = self.list_models().await;

        Ok(())
    }

    /// 拉取模型（如果不存在）
    pub async fn ensure_model(&self, name: &str) -> Result<(), OllamaError> {
        if !self.has_model(name).await? {
            if self.config.auto_pull {
                self.pull_model(name).await?;
            } else {
                return Err(OllamaError::ModelNotFound(name.to_string()));
            }
        }
        Ok(())
    }

    /// 生成文本
    pub async fn generate(&self, request: &GenerateRequest) -> Result<GenerateResponse, OllamaError> {
        let response = self.client
            .post(format!("{}/api/generate", self.config.base_url))
            .json(request)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(OllamaError::ApiError(format!(
                "Generation failed: {}",
                response.status()
            )));
        }

        let gen_response: GenerateResponse = response.json().await?;
        Ok(gen_response)
    }

    /// 流式生成
    pub async fn generate_stream(
        &self,
        request: &GenerateRequest,
    ) -> Result<impl futures::Stream<Item = Result<GenerateResponse, OllamaError>>, OllamaError> {
        let response = self.client
            .post(format!("{}/api/generate", self.config.base_url))
            .json(request)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(OllamaError::ApiError(format!(
                "Stream generation failed: {}",
                response.status()
            )));
        }

        let stream = response.bytes_stream().map(move |chunk| {
            let data = chunk?;
            let text = String::from_utf8_lossy(&data);
            
            // 解析每行 JSON
            for line in text.lines() {
                if let Ok(resp) = serde_json::from_str::<GenerateResponse>(line) {
                    return Ok(resp);
                }
            }
            
            Err(OllamaError::ParseError("Failed to parse stream chunk".to_string()))
        });

        Ok(stream)
    }

    /// 删除模型
    pub async fn delete_model(&self, name: &str) -> Result<(), OllamaError> {
        let response = self.client
            .delete(format!("{}/api/delete", self.config.base_url))
            .json(&serde_json::json!({ "name": name }))
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(OllamaError::ApiError(format!(
                "Failed to delete model: {}",
                response.status()
            )));
        }

        // 刷新缓存
        let _ = self.list_models().await;

        Ok(())
    }

    /// 复制模型
    pub async fn copy_model(&self, source: &str, destination: &str) -> Result<(), OllamaError> {
        let response = self.client
            .post(format!("{}/api/copy", self.config.base_url))
            .json(&serde_json::json!({ "source": source, "destination": destination }))
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(OllamaError::ApiError(format!(
                "Failed to copy model: {}",
                response.status()
            )));
        }

        Ok(())
    }

    /// 获取模型信息
    pub async fn get_model_info(&self, name: &str) -> Result<OllamaModel, OllamaError> {
        let models = self.list_models().await?;
        models.into_iter()
            .find(|m| m.name == name)
            .ok_or_else(|| OllamaError::ModelNotFound(name.to_string()))
    }

    /// 刷新模型缓存
    pub async fn refresh_models(&self) -> Result<Vec<OllamaModel>, OllamaError> {
        self.list_models().await
    }
}

/// Ollama 标签响应
#[derive(Debug, Deserialize)]
struct TagsResponse {
    models: Vec<OllamaModel>,
}

/// Ollama 错误
#[derive(Debug, Error)]
pub enum OllamaError {
    #[error("Network error: {0}")]
    NetworkError(#[from] reqwest::Error),

    #[error("API error: {0}")]
    ApiError(String),

    #[error("Model not found: {0}")]
    ModelNotFound(String),

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ollama_config_default() {
        let config = OllamaConfig::default();
        assert_eq!(config.base_url, "http://localhost:11434");
        assert!(config.auto_pull);
    }
}
