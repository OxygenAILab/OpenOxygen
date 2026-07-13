//! OCR 引擎集成
//! 
//! 支持 Tesseract、PaddleOCR、Windows OCR

use image::DynamicImage;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;
use thiserror::Error;

/// OCR 引擎类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum OcrEngine {
    /// Tesseract OCR
    Tesseract,
    /// PaddleOCR
    PaddleOcr,
    /// Windows OCR (Windows.Media.Ocr)
    WindowsOcr,
    /// 在线 OCR API
    Online(String),
}

/// OCR 配置
#[derive(Debug, Clone)]
pub struct OcrConfig {
    pub engine: OcrEngine,
    /// 语言设置
    pub languages: Vec<String>,
    /// 置信度阈值
    pub confidence_threshold: f32,
    /// 预处理配置
    pub preprocess: PreprocessConfig,
    /// 引擎特定配置
    pub engine_config: HashMap<String, String>,
}

impl Default for OcrConfig {
    fn default() -> Self {
        Self {
            engine: OcrEngine::Tesseract,
            languages: vec!["eng".to_string()],
            confidence_threshold: 0.6,
            preprocess: PreprocessConfig::default(),
            engine_config: HashMap::new(),
        }
    }
}

/// 预处理配置
#[derive(Debug, Clone)]
pub struct PreprocessConfig {
    /// 灰度化
    pub grayscale: bool,
    /// 二值化
    pub binarize: bool,
    /// 去噪
    pub denoise: bool,
    /// 缩放因子
    pub scale_factor: f32,
    /// 对比度增强
    pub contrast_enhance: bool,
    /// 锐化
    pub sharpen: bool,
}

impl Default for PreprocessConfig {
    fn default() -> Self {
        Self {
            grayscale: true,
            binarize: false,
            denoise: true,
            scale_factor: 1.0,
            contrast_enhance: true,
            sharpen: false,
        }
    }
}

/// 文本块
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextBlock {
    pub id: String,
    pub text: String,
    /// 边界框 (x, y, width, height)
    pub bbox: (i32, i32, i32, i32),
    /// 置信度 (0.0 - 1.0)
    pub confidence: f32,
    /// 文本角度
    pub angle: f32,
    /// 字体大小估计
    pub font_size: Option<f32>,
    /// 是否可编辑
    pub is_editable: bool,
    /// 语言检测
    pub language: Option<String>,
}

/// OCR 结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrResult {
    pub text_blocks: Vec<TextBlock>,
    pub full_text: String,
    pub processing_time_ms: u64,
    pub engine_used: String,
    pub avg_confidence: f32,
}

/// OCR 引擎
pub struct OcrEngineWrapper {
    config: OcrConfig,
    engine: Box<dyn OcrEngineTrait>,
}

/// OCR 引擎 trait
trait OcrEngineTrait: Send + Sync {
    fn recognize(&self, image: &DynamicImage) -> Result<OcrResult, OcrError>;
    fn name(&self) -> &str;
}

impl OcrEngineWrapper {
    /// 创建新的 OCR 引擎
    pub fn new(config: OcrConfig) -> Result<Self, OcrError> {
        let engine: Box<dyn OcrEngineTrait> = match &config.engine {
            OcrEngine::Tesseract => Box::new(TesseractEngine::new(&config)?),
            OcrEngine::PaddleOcr => Box::new(PaddleOcrEngine::new(&config)?),
            OcrEngine::WindowsOcr => Box::new(WindowsOcrEngine::new(&config)?),
            OcrEngine::Online(api_name) => Box::new(OnlineOcrEngine::new(api_name, &config)?),
        };

        Ok(Self { config, engine })
    }

    /// 识别图像中的文本
    pub fn recognize(&self, image: &DynamicImage) -> Result<OcrResult, OcrError> {
        let start = std::time::Instant::now();

        // 预处理
        let processed = self.preprocess(image)?;

        // OCR 识别
        let mut result = self.engine.recognize(&processed)?;

        // 后处理
        result = self.postprocess(result)?;

        // 过滤低置信度
        result.text_blocks.retain(|b| b.confidence >= self.config.confidence_threshold);

        // 更新统计
        result.processing_time_ms = start.elapsed().as_millis() as u64;
        result.avg_confidence = if !result.text_blocks.is_empty() {
            result.text_blocks.iter().map(|b| b.confidence).sum::<f32>() / result.text_blocks.len() as f32
        } else {
            0.0
        };

        Ok(result)
    }

    /// 快速识别（单行文本）
    pub fn recognize_text(&self, image: &DynamicImage) -> Result<String, OcrError> {
        let result = self.recognize(image)?;
        Ok(result.full_text)
    }

    /// 查找特定文本位置
    pub fn find_text(
        &self,
        image: &DynamicImage,
        target: &str,
        partial_match: bool,
    ) -> Result<Vec<TextBlock>, OcrError> {
        let result = self.recognize(image)?;
        let target_lower = target.to_lowercase();

        let matches: Vec<_> = result
            .text_blocks
            .into_iter()
            .filter(|b| {
                let text_lower = b.text.to_lowercase();
                if partial_match {
                    text_lower.contains(&target_lower)
                } else {
                    text_lower == target_lower
                }
            })
            .collect();

        Ok(matches)
    }

    /// 预处理图像
    fn preprocess(&self, image: &DynamicImage) -> Result<DynamicImage, OcrError> {
        let mut processed = image.clone();

        // 灰度化
        if self.config.preprocess.grayscale {
            processed = DynamicImage::ImageLuma8(processed.to_luma8());
        }

        // 缩放
        if self.config.preprocess.scale_factor != 1.0 {
            let new_width = (processed.width() as f32 * self.config.preprocess.scale_factor) as u32;
            let new_height = (processed.height() as f32 * self.config.preprocess.scale_factor) as u32;
            processed = processed.resize(new_width, new_height, image::imageops::FilterType::Lanczos3);
        }

        // 对比度增强
        if self.config.preprocess.contrast_enhance {
            // 直方图均衡化
            processed = self.enhance_contrast(&processed)?;
        }

        // 去噪
        if self.config.preprocess.denoise {
            processed = self.denoise(&processed)?;
        }

        // 二值化
        if self.config.preprocess.binarize {
            // 自适应阈值
            processed = DynamicImage::ImageLuma8(image::imageops::threshold(&processed.to_luma8(), 128));
        }

        Ok(processed)
    }

    /// 对比度增强
    fn enhance_contrast(&self, image: &DynamicImage) -> Result<DynamicImage, OcrError> {
        use image::imageops::contrast_in_place;
        let mut enhanced = image.clone();
        contrast_in_place(&mut enhanced.to_rgb8(), 1.5);
        Ok(enhanced)
    }

    /// 去噪
    fn denoise(&self, image: &DynamicImage) -> Result<DynamicImage, OcrError> {
        // 简单的高斯模糊去噪
        let blurred = image.blur(1.0);
        Ok(blurred)
    }

    /// 后处理结果
    fn postprocess(&self, mut result: OcrResult) -> Result<OcrResult, OcrError> {
        for block in &mut result.text_blocks {
            // 去除首尾空白
            block.text = block.text.trim().to_string();

            // 合并连续的空白
            block.text = block.text.split_whitespace().collect::<Vec<_>>().join(" ");

            // 修复常见 OCR 错误
            block.text = self.fix_common_errors(&block.text);
        }

        // 重新生成完整文本
        result.full_text = result.text_blocks.iter().map(|b| &b.text).collect::<Vec<_>>().join("\n");

        Ok(result)
    }

    /// 修复常见 OCR 错误
    fn fix_common_errors(&self, text: &str) -> String {
        let mut fixed = text.to_string();

        // 数字与字母混淆
        fixed = fixed.replace('0', "O"); // 根据上下文判断
        fixed = fixed.replace('1', "l"); // 根据上下文判断

        // 全角/半角转换
        fixed = fixed.replace('，', ",");
        fixed = fixed.replace('。', ".");
        fixed = fixed.replace('：', ":");

        // 其他常见错误
        fixed = fixed.replace("rn", "m");
        fixed = fixed.replace("nn", "m");

        fixed
    }
}

/// Tesseract 引擎
struct TesseractEngine {
    config: OcrConfig,
    tesseract_path: String,
}

impl TesseractEngine {
    fn new(config: &OcrConfig) -> Result<Self, OcrError> {
        // 查找 Tesseract 路径
        let tesseract_path = config
            .engine_config
            .get("tesseract_path")
            .cloned()
            .unwrap_or_else(|| "tesseract".to_string());

        // 验证 Tesseract 是否可用
        if !Self::check_tesseract(&tesseract_path) {
            return Err(OcrError::EngineNotAvailable(
                "Tesseract not found. Please install Tesseract OCR.".to_string(),
            ));
        }

        Ok(Self {
            config: config.clone(),
            tesseract_path,
        })
    }

    fn check_tesseract(path: &str) -> bool {
        Command::new(path).arg("--version").output().is_ok()
    }

    fn recognize_tesseract(&self, image_path: &str) -> Result<OcrResult, OcrError> {
        use std::process::Stdio;

        let lang = self.config.languages.join("+");

        let output = Command::new(&self.tesseract_path)
            .arg(image_path)
            .arg("stdout")
            .arg("-l")
            .arg(&lang)
            .arg("--psm")
            .arg("6") // 假设统一的文本块
            .arg("--oem")
            .arg("3") // LSTM 引擎
            .arg("tsv") // 输出 TSV 格式
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| OcrError::EngineError(format!("Failed to run Tesseract: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(OcrError::EngineError(format!("Tesseract failed: {}", stderr)));
        }

        // 解析 TSV 输出
        let tsv_output = String::from_utf8_lossy(&output.stdout);
        self.parse_tsv_output(&tsv_output)
    }

    fn parse_tsv_output(&self, tsv: &str) -> Result<OcrResult, OcrError> {
        let mut blocks = Vec::new();
        let mut lines = tsv.lines();

        // 跳过表头
        if let Some(header) = lines.next() {
            if !header.starts_with("level") {
                // 可能没有表头
            }
        }

        for line in lines {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 11 {
                // TSV 格式：level page_num block_num par_num line_num word_num left top width height conf text
                if let Ok(conf) = parts[10].parse::<f32>() {
                    if conf >= 0.0 {
                        let text = if parts.len() > 11 { parts[11] } else { "" };
                        let left = parts[6].parse::<i32>().unwrap_or(0);
                        let top = parts[7].parse::<i32>().unwrap_or(0);
                        let width = parts[8].parse::<i32>().unwrap_or(0);
                        let height = parts[9].parse::<i32>().unwrap_or(0);

                        blocks.push(TextBlock {
                            id: format!("block_{}", blocks.len()),
                            text: text.to_string(),
                            bbox: (left, top, width, height),
                            confidence: conf / 100.0,
                            angle: 0.0,
                            font_size: None,
                            is_editable: false,
                            language: Some(self.config.languages[0].clone()),
                        });
                    }
                }
            }
        }

        let full_text = blocks.iter().map(|b| &b.text).collect::<Vec<_>>().join("\n");

        Ok(OcrResult {
            text_blocks: blocks,
            full_text,
            processing_time_ms: 0,
            engine_used: "tesseract".to_string(),
            avg_confidence: 0.0,
        })
    }
}

impl OcrEngineTrait for TesseractEngine {
    fn recognize(&self, image: &DynamicImage) -> Result<OcrResult, OcrError> {
        // 保存临时文件
        let temp_path = std::env::temp_dir().join("ocr_temp.png");
        image.save(&temp_path).map_err(|e| OcrError::ImageError(e.to_string()))?;

        let result = self.recognize_tesseract(temp_path.to_str().unwrap())?;

        // 清理临时文件
        let _ = std::fs::remove_file(&temp_path);

        Ok(result)
    }

    fn name(&self) -> &str {
        "tesseract"
    }
}

/// PaddleOCR 引擎
struct PaddleOcrEngine {
    config: OcrConfig,
}

impl PaddleOcrEngine {
    fn new(config: &OcrConfig) -> Result<Self, OcrError> {
        Ok(Self {
            config: config.clone(),
        })
    }
}

impl OcrEngineTrait for PaddleOcrEngine {
    fn recognize(&self, _image: &DynamicImage) -> Result<OcrResult, OcrError> {
        // TODO: 实现 PaddleOCR 集成
        // 通常通过 Python API 或命令行调用
        Err(OcrError::NotImplemented("PaddleOCR integration pending".to_string()))
    }

    fn name(&self) -> &str {
        "paddleocr"
    }
}

/// Windows OCR 引擎
#[cfg(windows)]
struct WindowsOcrEngine {
    config: OcrConfig,
}

#[cfg(windows)]
impl WindowsOcrEngine {
    fn new(config: &OcrConfig) -> Result<Self, OcrError> {
        Ok(Self {
            config: config.clone(),
        })
    }
}

#[cfg(windows)]
impl OcrEngineTrait for WindowsOcrEngine {
    fn recognize(&self, _image: &DynamicImage) -> Result<OcrResult, OcrError> {
        // 使用 Windows.Media.Ocr
        // 需要通过 windows-rs 绑定
        // TODO: 实现 Windows OCR API 调用
        Err(OcrError::NotImplemented("Windows OCR integration pending".to_string()))
    }

    fn name(&self) -> &str {
        "windows_ocr"
    }
}

#[cfg(not(windows))]
struct WindowsOcrEngine {
    config: OcrConfig,
}

#[cfg(not(windows))]
impl WindowsOcrEngine {
    fn new(_config: &OcrConfig) -> Result<Self, OcrError> {
        Err(OcrError::EngineNotAvailable("Windows OCR only available on Windows".to_string()))
    }
}

#[cfg(not(windows))]
impl OcrEngineTrait for WindowsOcrEngine {
    fn recognize(&self, _image: &DynamicImage) -> Result<OcrResult, OcrError> {
        Err(OcrError::EngineNotAvailable("Windows OCR only available on Windows".to_string()))
    }

    fn name(&self) -> &str {
        "windows_ocr"
    }
}

/// 在线 OCR 引擎
struct OnlineOcrEngine {
    api_name: String,
    config: OcrConfig,
}

impl OnlineOcrEngine {
    fn new(api_name: &str, config: &OcrConfig) -> Result<Self, OcrError> {
        Ok(Self {
            api_name: api_name.to_string(),
            config: config.clone(),
        })
    }
}

impl OcrEngineTrait for OnlineOcrEngine {
    fn recognize(&self, _image: &DynamicImage) -> Result<OcrResult, OcrError> {
        // TODO: 实现在线 OCR API 调用
        // 支持百度 OCR、腾讯 OCR、Azure Computer Vision 等
        Err(OcrError::NotImplemented(format!("Online OCR {} not implemented", self.api_name)))
    }

    fn name(&self) -> &str {
        &self.api_name
    }
}

/// OCR 错误
#[derive(Error, Debug)]
pub enum OcrError {
    #[error("Engine not available: {0}")]
    EngineNotAvailable(String),

    #[error("Engine error: {0}")]
    EngineError(String),

    #[error("Image error: {0}")]
    ImageError(String),

    #[error("Not implemented: {0}")]
    NotImplemented(String),

    #[error("Preprocessing error: {0}")]
    PreprocessError(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ocr_config_default() {
        let config = OcrConfig::default();
        assert_eq!(config.engine, OcrEngine::Tesseract);
        assert_eq!(config.confidence_threshold, 0.6);
    }
}
