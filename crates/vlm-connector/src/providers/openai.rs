//! OpenAI VLM Provider
//! 
//! GPT-4V, GPT-4o 视觉模型支持

use reqwest::{Client, header};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;

use crate::{VlmConfig, VlmError, VisionRequest, VisionResponse, TokenUsage};

/// OpenAI 响应
#[derive(Debug, Deserialize)]
struct OpenAiResponse {
    id: String,
    model: String,
    choices: Vec<OpenAiChoice>,
    usage: OpenAiUsage,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
    finish_reason: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiUsage {
    prompt_tokens: u32,
    completion_tokens: u32,
    total_tokens: u32,
}

/// OpenAI VLM Provider
pub struct OpenAiProvider {
    client: Client,
    api_key: String,
    base_url: String,
    model: String,
}

impl OpenAiProvider {
    pub fn new(config: &VlmConfig) -> Result<Self, VlmError> {
        let client = Client::builder()
            .timeout(Duration::from_millis(config.timeout_ms))
            .build()
            .map_err(|e| VlmError::NetworkError(e.to_string()))?;

        let base_url = config.base_url.clone()
            .unwrap_or_else(|| "https://api.openai.com".to_string());

        Ok(Self {
            client,
            api_key: config.api_key.clone(),
            base_url,
            model: config.model.clone(),
        })
    }

    /// 调用 OpenAI Vision API
    pub async fn complete(&self, request: &VisionRequest) -> Result<VisionResponse, VlmError> {
        let url = format!("{}/v1/chat/completions", self.base_url);

        // 构建消息
        let messages = vec![
            json!({
                "role": "system",
                "content": request.system.as_deref().unwrap_or("You are a helpful assistant that analyzes images.")
            }),
            json!({
                "role": "user",
                "content": self.build_content(request)
            }),
        ];

        // 构建请求体
        let body = json!({
            "model": self.model,
            "messages": messages,
            "temperature": request.temperature.unwrap_or(0.7),
            "max_tokens": request.max_tokens.unwrap_or(2000),
            "response_format": if request.json_mode { 
                json!({"type": "json_object"})
            } else {
                json!(null)
            },
        });

        // 发送请求
        let response = self.client
            .post(&url)
            .header(header::AUTHORIZATION, format!("Bearer {}", self.api_key))
            .header(header::CONTENT_TYPE, "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| VlmError::NetworkError(e.to_string()))?;

        // 检查状态码
        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(VlmError::ApiError(format!(
                "OpenAI API error ({}): {}", status, error_text
            )));
        }

        // 解析响应
        let openai_resp: OpenAiResponse = response.json().await
            .map_err(|e| VlmError::ParseError(format!("Failed to parse response: {}", e)))?;

        // 提取内容
        let content = openai_resp.choices
            .get(0)
            .map(|c| c.message.content.clone())
            .unwrap_or_default();

        Ok(VisionResponse {
            content,
            usage: TokenUsage {
                prompt_tokens: openai_resp.usage.prompt_tokens,
                completion_tokens: openai_resp.usage.completion_tokens,
                total_tokens: openai_resp.usage.total_tokens,
            },
            model: openai_resp.model,
        })
    }

    /// 构建带图像的内容
    fn build_content(&self, request: &VisionRequest) -> Vec<serde_json::Value> {
        let mut content = vec![
            json!({
                "type": "text",
                "text": request.prompt
            })
        ];

        // 添加图像
        for image in &request.images {
            let image_url = self.image_to_url(image);
            content.push(json!({
                "type": "image_url",
                "image_url": {
                    "url": image_url,
                    "detail": request.image_detail.as_deref().unwrap_or("auto")
                }
            }));
        }

        content
    }

    /// 图像转 URL
    fn image_to_url(&self, image: &super::ImageInput) -> String {
        match image {
            super::ImageInput::Base64(b64) => b64.clone(),
            super::ImageInput::Path(path) => {
                // 读取文件并转为 base64
                match std::fs::read(path) {
                    Ok(bytes) => {
                        let b64 = base64::encode(&bytes);
                        format!("data:image/png;base64,{}, b64)
                    }
                    Err(_) => format!("file://{}", path.display())
                }
            }
            super::ImageInput::Image(img) => {
                // 编码为 base64
                let mut buffer = Vec::new();
                img.write_to(&mut std::io::Cursor::new(&mut buffer), image::ImageFormat::Png).ok();
                let b64 = base64::encode(&buffer);
                format!("data:image/png;base64,{}, b64)
            }
            super::ImageInput::Url(url) => url.clone(),
        }
    }

    /// 流式请求
    pub async fn stream(
        &self,
        request: &VisionRequest,
    ) -> Result<impl futures::Stream<Item = Result<String, VlmError>>, VlmError> {
        let url = format!("{}/v1/chat/completions", self.base_url);

        let messages = vec![
            json!({
                "role": "system",
                "content": request.system.as_deref().unwrap_or("")
            }),
            json!({
                "role": "user",
                "content": self.build_content(request)
            }),
        ];

        let body = json!({
            "model": self.model,
            "messages": messages,
            "temperature": request.temperature.unwrap_or(0.7),
            "max_tokens": request.max_tokens.unwrap_or(2000),
            "stream": true,
        });

        let response = self.client
            .post(&url)
            .header(header::AUTHORIZATION, format!("Bearer {}", self.api_key))
            .json(&body)
            .send()
            .await
            .map_err(|e| VlmError::NetworkError(e.to_string()))?;

        // 返回 SSE 流
        Ok(response.bytes_stream().map(|chunk| {
            chunk.map_err(|e| VlmError::NetworkError(e.to_string()))
                .and_then(|bytes| {
                    let text = String::from_utf8_lossy(&bytes);
                    Self::parse_stream_chunk(&text)
                })
        }))
    }

    /// 解析流式块
    fn parse_stream_chunk(text: &str) -> Result<String, VlmError> {
        // SSE 格式: data: {...}
        for line in text.lines() {
            if line.starts_with("data: ") {
                let data = &line[6..];
                if data == "[DONE]" {
                    return Ok(String::new());
                }
                
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(content) = json["choices"][0]["delta"]["content"].as_str() {
                        return Ok(content.to_string());
                    }
                }
            }
        }
        Ok(String::new())
    }
}

// Base64 编码
mod base64 {
    pub fn encode<T: AsRef<[u8]>>(input: T) -> String {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(input.as_ref())
    }
}
