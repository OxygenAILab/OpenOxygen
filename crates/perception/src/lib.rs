//! 感知模块
//! 
//! 屏幕理解、OCR、元素检测

use image::DynamicImage;
use serde::{Deserialize, Serialize};

pub mod ocr;
pub mod vision;
pub mod element;

/// 感知处理器
pub struct PerceptionEngine {
    ocr: ocr::OcrEngine,
    vision: vision::VisionEngine,
    element: element::ElementDetector,
}

/// 检测请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionRequest {
    pub request_type: DetectionType,
    pub image: String, // base64
    pub params: DetectionParams,
}

/// 检测类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DetectionType {
    Text,
    Elements,
    Objects,
    Faces,
    Icons,
    Custom(String),
}

/// 检测参数
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DetectionParams {
    pub confidence_threshold: f32,
    pub max_results: usize,
    pub region: Option<Region>,
    pub languages: Vec<String>,
}

/// 区域
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Region {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// 检测结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionResult {
    pub detections: Vec<Detection>,
    pub processing_time_ms: u64,
    pub image_dimensions: (u32, u32),
}

/// 单个检测
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Detection {
    pub id: String,
    pub label: String,
    pub confidence: f32,
    pub bbox: BoundingBox,
    pub center: (i32, i32),
    pub metadata: Option<serde_json::Value>,
}

/// 边界框
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoundingBox {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl PerceptionEngine {
    /// 创建新的感知引擎
    pub fn new() -> Result<Self, PerceptionError> {
        Ok(Self {
            ocr: ocr::OcrEngine::new()?,
            vision: vision::VisionEngine::new()?,
            element: element::ElementDetector::new()?,
        })
    }

    /// 检测
    pub async fn detect(&self, request: DetectionRequest) -> Result<DetectionResult, PerceptionError> {
        let start = std::time::Instant::now();
        
        // 解码图像
        let image = self.decode_image(&request.image)?;
        let (width, height) = (image.width(), image.height());
        
        // 裁剪区域
        let image = if let Some(region) = &request.params.region {
            image.crop_imm(region.x as u32, region.y as u32, region.width, region.height)
        } else {
            image
        };

        // 根据类型执行检测
        let detections = match request.request_type {
            DetectionType::Text => self.ocr.detect_text(&image, &request.params).await?,
            DetectionType::Elements => self.element.detect(&image, &request.params).await?,
            DetectionType::Objects => self.vision.detect_objects(&image, &request.params).await?,
            _ => vec![],
        };

        Ok(DetectionResult {
            detections,
            processing_time_ms: start.elapsed().as_millis() as u64,
            image_dimensions: (width, height),
        })
    }

    /// 查找文本
    pub async fn find_text(
        &self, 
        image: &DynamicImage, 
        text: &str,
        partial: bool
    ) -> Result<(i32, i32), PerceptionError> {
        let request = DetectionRequest {
            request_type: DetectionType::Text,
            image: self.encode_image(image)?,
            params: DetectionParams::default(),
        };

        let result = self.detect(request).await?;

        for detection in result.detections {
            if partial && detection.label.contains(text) {
                return Ok(detection.center);
            }
            if !partial && detection.label == text {
                return Ok(detection.center);
            }
        }

        Err(PerceptionError::NotFound(format!("Text '{}' not found", text)))
    }

    /// 查找图像
    pub async fn find_image(
        &self,
        screenshot: &DynamicImage,
        template: &DynamicImage,
        confidence: f32,
    ) -> Result<(i32, i32), PerceptionError> {
        // 模板匹配
        let result = self.vision.template_match(screenshot, template, confidence).await?;
        Ok(result)
    }

    /// 根据描述定位
    pub async fn locate_by_description(
        &self,
        image: &DynamicImage,
        description: &str,
    ) -> Result<(i32, i32), PerceptionError> {
        // 使用 LLM 或视觉模型理解描述并定位
        self.vision.locate_by_description(image, description).await
    }

    /// 解码图像
    fn decode_image(&self, base64: &str) -> Result<DynamicImage, PerceptionError> {
        let bytes = base64::decode(base64)
            .map_err(|e| PerceptionError::DecodeError(e.to_string()))?;
        
        image::load_from_memory(&bytes)
            .map_err(|e| PerceptionError::DecodeError(e.to_string()))
    }

    /// 编码图像
    fn encode_image(&self, image: &DynamicImage) -> Result<String, PerceptionError> {
        let mut buffer = std::io::Cursor::new(Vec::new());
        image.write_to(&mut buffer, image::ImageFormat::Png)
            .map_err(|e| PerceptionError::EncodeError(e.to_string()))?;
        
        Ok(base64::encode(buffer.into_inner()))
    }
}

/// 感知错误
#[derive(Debug, thiserror::Error)]
pub enum PerceptionError {
    #[error("OCR error: {0}")]
    OcrError(String),
    
    #[error("Vision error: {0}")]
    VisionError(String),
    
    #[error("Element detection error: {0}")]
    ElementError(String),
    
    #[error("Decode error: {0}")]
    DecodeError(String),
    
    #[error("Encode error: {0}")]
    EncodeError(String),
    
    #[error("Not found: {0}")]
    NotFound(String),
    
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}

// Base64 utilities
mod base64 {
    pub fn decode(input: &str) -> Result<Vec<u8>, base64::DecodeError> {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.decode(input)
    }

    pub fn encode<T: AsRef<[u8]>>(input: T) -> String {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(input)
    }
}

// Stub modules
pub mod ocr {
    use super::*;
    
    pub struct OcrEngine;
    
    impl OcrEngine {
        pub fn new() -> Result<Self, PerceptionError> {
            Ok(Self)
        }
        
        pub async fn detect_text(
            &self, 
            _image: &DynamicImage, 
            _params: &DetectionParams
        ) -> Result<Vec<Detection>, PerceptionError> {
            // TODO: Implement OCR
            Ok(vec![])
        }
    }
}

pub mod vision {
    use super::*;
    
    pub struct VisionEngine;
    
    impl VisionEngine {
        pub fn new() -> Result<Self, PerceptionError> {
            Ok(Self)
        }
        
        pub async fn detect_objects(
            &self, 
            _image: &DynamicImage, 
            _params: &DetectionParams
        ) -> Result<Vec<Detection>, PerceptionError> {
            Ok(vec![])
        }
        
        pub async fn template_match(
            &self,
            _screenshot: &DynamicImage,
            _template: &DynamicImage,
            _confidence: f32,
        ) -> Result<(i32, i32), PerceptionError> {
            Ok((0, 0))
        }
        
        pub async fn locate_by_description(
            &self,
            _image: &DynamicImage,
            _description: &str,
        ) -> Result<(i32, i32), PerceptionError> {
            Ok((0, 0))
        }
    }
}

pub mod element {
    use super::*;
    
    pub struct ElementDetector;
    
    impl ElementDetector {
        pub fn new() -> Result<Self, PerceptionError> {
            Ok(Self)
        }
        
        pub async fn detect(
            &self, 
            _image: &DynamicImage, 
            _params: &DetectionParams
        ) -> Result<Vec<Detection>, PerceptionError> {
            Ok(vec![])
        }
    }
}
