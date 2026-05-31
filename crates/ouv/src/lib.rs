//! OpenOxygen Next - OUV (OpenOxygen Unified Vision)
//! 
//! 三层融合视觉处理模块
//! L1: 原始像素层 (Pixel Layer) - 屏幕捕获、预处理
//! L2: 特征提取层 (Feature Layer) - OCR、元素检测、图标识别
//! L3: 语义理解层 (Semantic Layer) - VLM 理解、意图解析

use std::sync::Arc;
use tokio::sync::RwLock;
use image::{DynamicImage, Rgba, ImageBuffer};
use serde::{Deserialize, Serialize};

pub mod pixel_layer;
pub mod feature_layer;
pub mod semantic_layer;

/// OUV 三层融合引擎
pub struct OuvEngine {
    /// 像素层
    pixel_layer: Arc<RwLock<pixel_layer::PixelLayer>>,
    /// 特征层
    feature_layer: Arc<RwLock<feature_layer::FeatureLayer>>,
    /// 语义层
    semantic_layer: Arc<RwLock<semantic_layer::SemanticLayer>>,
    /// 融合配置
    config: OuvConfig,
}

/// OUV 配置
#[derive(Debug, Clone)]
pub struct OuvConfig {
    /// 截图质量
    pub screenshot_quality: ScreenshotQuality,
    /// 是否启用像素层
    pub enable_pixel: bool,
    /// 是否启用特征层
    pub enable_feature: bool,
    /// 是否启用语义层
    pub enable_semantic: bool,
    /// 特征层置信度阈值
    pub feature_confidence: f32,
    /// 语义层超时 (ms)
    pub semantic_timeout_ms: u64,
    /// 最大重试次数
    pub max_retries: u32,
}

impl Default for OuvConfig {
    fn default() -> Self {
        Self {
            screenshot_quality: ScreenshotQuality::High,
            enable_pixel: true,
            enable_feature: true,
            enable_semantic: true,
            feature_confidence: 0.75,
            semantic_timeout_ms: 30000,
            max_retries: 3,
        }
    }
}

/// 截图质量
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ScreenshotQuality {
    Low,      // 快速，低分辨率
    Medium,   // 平衡
    High,     // 高质量
    Raw,      // 原始无损
}

/// OUV 处理请求
#[derive(Debug, Clone)]
pub struct OuvRequest {
    /// 请求类型
    pub request_type: OuvRequestType,
    /// 截图输入
    pub screenshot: Option<ScreenshotInput>,
    /// 历史截图（用于上下文）
    pub history_screenshots: Vec<ScreenshotInput>,
    /// 用户指令/问题
    pub instruction: String,
    /// 期望输出格式
    pub output_format: OuvOutputFormat,
    /// 时间限制
    pub timeout_ms: u64,
}

/// OUV 请求类型
#[derive(Debug, Clone)]
pub enum OuvRequestType {
    /// 元素检测
    ElementDetection,
    /// 文本识别
    TextRecognition,
    /// 图标识别
    IconRecognition,
    /// 场景理解
    SceneUnderstanding,
    /// 操作预测
    ActionPrediction { previous_actions: Vec<String> },
    /// 变化检测
    ChangeDetection { previous_screenshot: ScreenshotInput },
    /// 自定义查询
    CustomQuery { query: String },
}

/// 截图输入
#[derive(Debug, Clone)]
pub enum ScreenshotInput {
    /// Base64 编码
    Base64(String),
    /// 文件路径
    Path(std::path::PathBuf),
    /// 图像对象
    Image(DynamicImage),
}

/// 输出格式
#[derive(Debug, Clone)]
pub enum OuvOutputFormat {
    /// 元素列表
    ElementList,
    /// 文本列表
    TextList,
    /// 操作预测
    ActionPrediction,
    /// 场景描述
    SceneDescription,
    /// JSON 结构化
    StructuredJson,
    /// 原始融合数据
    FullFusion,
}

/// OUV 处理结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OuvResult {
    /// 请求 ID
    pub request_id: String,
    /// 处理耗时 (ms)
    pub processing_time_ms: u64,
    /// 各层输出
    pub layers: LayerOutputs,
    /// 融合结果
    pub fusion: FusionResult,
    /// 元数据
    pub metadata: OuvMetadata,
}

/// 各层输出
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayerOutputs {
    /// 像素层输出
    pub pixel: Option<PixelOutput>,
    /// 特征层输出
    pub feature: Option<FeatureOutput>,
    /// 语义层输出
    pub semantic: Option<SemanticOutput>,
}

/// 像素层输出
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PixelOutput {
    /// 图像尺寸
    pub dimensions: (u32, u32),
    /// 截图区域
    pub region: Option<ScreenRegion>,
    /// 预处理后的图像 (base64)
    pub processed_image: Option<String>,
    /// 图像哈希 (用于变化检测)
    pub image_hash: String,
    /// 压缩率
    pub compression_ratio: f32,
}

/// 屏幕区域
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenRegion {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// 特征层输出
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeatureOutput {
    /// 检测到的文本块
    pub text_blocks: Vec<TextBlock>,
    /// 检测到的 UI 元素
    pub ui_elements: Vec<UiElement>,
    /// 检测到的图标
    pub icons: Vec<Icon>,
    /// 特征层处理时间
    pub processing_time_ms: u64,
    /// 置信度统计
    pub confidence_stats: ConfidenceStats,
}

/// 文本块
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextBlock {
    pub id: String,
    pub text: String,
    pub bbox: BoundingBox,
    pub confidence: f32,
    pub font_size: Option<f32>,
    pub is_editable: bool,
}

/// 边界框
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct BoundingBox {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl BoundingBox {
    /// 获取中心点
    pub fn center(&self) -> (i32, i32) {
        (self.x + self.width / 2, self.y + self.height / 2)
    }
    
    /// 检查点是否在框内
    pub fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.x && x <= self.x + self.width &&
        y >= self.y && y <= self.y + self.height
    }
    
    /// 计算与其他框的 IoU
    pub fn iou(&self, other: &BoundingBox) -> f32 {
        let x1 = self.x.max(other.x);
        let y1 = self.y.max(other.y);
        let x2 = (self.x + self.width).min(other.x + other.width);
        let y2 = (self.y + self.height).min(other.y + other.height);
        
        if x2 <= x1 || y2 <= y1 {
            return 0.0;
        }
        
        let intersection = (x2 - x1) * (y2 - y1);
        let area1 = self.width * self.height;
        let area2 = other.width * other.height;
        let union = area1 + area2 - intersection;
        
        intersection as f32 / union as f32
    }
}

/// UI 元素
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiElement {
    pub id: String,
    pub element_type: ElementType,
    pub bbox: BoundingBox,
    pub confidence: f32,
    pub attributes: ElementAttributes,
    pub content: Option<String>,
    pub state: ElementState,
}

/// 元素类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ElementType {
    Button,
    Input,
    TextArea,
    Checkbox,
    Radio,
    Select,
    Link,
    Image,
    Container,
    Scrollbar,
    Menu,
    MenuItem,
    Dialog,
    Tab,
    Unknown,
}

/// 元素属性
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ElementAttributes {
    pub name: Option<String>,
    pub class: Option<String>,
    pub id: Option<String>,
    pub aria_label: Option<String>,
    pub tooltip: Option<String>,
    pub color: Option<String>,
    pub font_family: Option<String>,
}

/// 元素状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ElementState {
    Normal,
    Hovered,
    Active,
    Disabled,
    Focused,
    Selected,
    Hidden,
}

/// 图标
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Icon {
    pub id: String,
    pub icon_type: IconType,
    pub bbox: BoundingBox,
    pub confidence: f32,
}

/// 图标类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum IconType {
    Close,
    Minimize,
    Maximize,
    Back,
    Forward,
    Refresh,
    Home,
    Search,
    Menu,
    Settings,
    User,
    Notification,
    Custom(String),
}

/// 置信度统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfidenceStats {
    pub min: f32,
    pub max: f32,
    pub mean: f32,
    pub median: f32,
}

/// 语义层输出
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticOutput {
    /// 场景描述
    pub scene_description: String,
    /// 识别出的操作意图
    pub detected_intents: Vec<UserIntent>,
    /// 预测的下一步操作
    pub predicted_action: Option<PredictedAction>,
    /// 置信度
    pub confidence: f32,
    /// 使用的 VLM 模型
    pub vlm_model: String,
    /// 处理时间
    pub processing_time_ms: u64,
    /// 原始响应
    pub raw_response: String,
}

/// 用户意图
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserIntent {
    pub intent_type: IntentType,
    pub confidence: f32,
    pub target: Option<String>,
    pub parameters: serde_json::Value,
}

/// 意图类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntentType {
    Navigate,
    Input,
    Click,
    Search,
    Select,
    Scroll,
    Wait,
    Verify,
    Cancel,
    Confirm,
    Unknown,
}

/// 预测操作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PredictedAction {
    pub action_type: ActionType,
    pub target_element_id: Option<String>,
    pub target_coordinates: Option<(i32, i32)>,
    pub target_description: Option<String>,
    pub parameters: serde_json::Value,
    pub reasoning: String,
    pub confidence: f32,
}

/// 操作类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionType {
    Click,
    DoubleClick,
    RightClick,
    Type,
    KeyPress,
    ScrollUp,
    ScrollDown,
    Drag,
    Hover,
    Wait,
    Navigate,
    GoBack,
    TakeScreenshot,
    None,
}

/// 融合结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FusionResult {
    /// 综合置信度
    pub confidence: f32,
    /// 推荐的交互元素列表（排序后）
    pub recommended_elements: Vec<RecommendedElement>,
    /// 场景摘要
    pub scene_summary: String,
    /// 可执行操作建议
    pub actionable_suggestions: Vec<ActionSuggestion>,
    /// 各层一致性分数
    pub layer_consistency: f32,
}

/// 推荐元素
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecommendedElement {
    pub element_id: String,
    pub element_type: ElementType,
    pub bbox: BoundingBox,
    pub relevance_score: f32,
    pub relevance_reason: String,
}

/// 操作建议
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionSuggestion {
    pub action: PredictedAction,
    pub priority: i32,
    pub expected_outcome: String,
}

/// 元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OuvMetadata {
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub config_used: String,
    pub layers_enabled: Vec<String>,
    pub retry_count: u32,
}

impl OuvEngine {
    /// 创建新的 OUV 引擎
    pub fn new(config: OuvConfig) -> Result<Self, OuvError> {
        Ok(Self {
            pixel_layer: Arc::new(RwLock::new(pixel_layer::PixelLayer::new(&config)?)),
            feature_layer: Arc::new(RwLock::new(feature_layer::FeatureLayer::new(&config)?)),
            semantic_layer: Arc::new(RwLock::new(semantic_layer::SemanticLayer::new(&config)?)),
            config,
        })
    }

    /// 处理请求
    pub async fn process(&self, request: OuvRequest) -> Result<OuvResult, OuvError> {
        let start = std::time::Instant::now();
        let request_id = uuid::Uuid::new_v4().to_string();
        
        // 获取截图
        let screenshot = self.load_screenshot(&request.screenshot).await?;
        
        // 并行处理各层
        let (pixel_out, feature_out, semantic_out) = tokio::join!(
            self.process_pixel_layer(&screenshot, &request),
            self.process_feature_layer(&screenshot, &request),
            self.process_semantic_layer(&screenshot, &request),
        );
        
        let pixel_out = pixel_out?;
        let feature_out = feature_out?;
        let semantic_out = semantic_out?;
        
        // 融合结果
        let fusion = self.fuse_results(&pixel_out, &feature_out, &semantic_out, &request).await?;
        
        let processing_time = start.elapsed().as_millis() as u64;
        
        Ok(OuvResult {
            request_id,
            processing_time_ms: processing_time,
            layers: LayerOutputs {
                pixel: pixel_out,
                feature: feature_out,
                semantic: semantic_out,
            },
            fusion,
            metadata: OuvMetadata {
                timestamp: chrono::Utc::now(),
                config_used: format!("{:?}", self.config),
                layers_enabled: vec![
                    if self.config.enable_pixel { "pixel" } else { "" }.to_string(),
                    if self.config.enable_feature { "feature" } else { "" }.to_string(),
                    if self.config.enable_semantic { "semantic" } else { "" }.to_string(),
                ],
                retry_count: 0,
            },
        })
    }

    /// 加载截图
    async fn load_screenshot(
        &self,
        input: &Option<ScreenshotInput>,
    ) -> Result<DynamicImage, OuvError> {
        let input = input.as_ref().ok_or(OuvError::MissingScreenshot)?;
        
        match input {
            ScreenshotInput::Base64(b64) => {
                let bytes = base64::decode(b64)
                    .map_err(|e| OuvError::ImageError(e.to_string()))?;
                image::load_from_memory(&bytes)
                    .map_err(|e| OuvError::ImageError(e.to_string()))
            }
            ScreenshotInput::Path(path) => {
                image::open(path)
                    .map_err(|e| OuvError::ImageError(e.to_string()))
            }
            ScreenshotInput::Image(img) => Ok(img.clone()),
        }
    }

    /// 处理像素层
    async fn process_pixel_layer(
        &self,
        screenshot: &DynamicImage,
        _request: &OuvRequest,
    ) -> Result<Option<PixelOutput>, OuvError> {
        if !self.config.enable_pixel {
            return Ok(None);
        }
        
        let layer = self.pixel_layer.read().await;
        layer.process(screenshot).await.map(Some)
    }

    /// 处理特征层
    async fn process_feature_layer(
        &self,
        screenshot: &DynamicImage,
        _request: &OuvRequest,
    ) -> Result<Option<FeatureOutput>, OuvError> {
        if !self.config.enable_feature {
            return Ok(None);
        }
        
        let layer = self.feature_layer.read().await;
        layer.process(screenshot).await.map(Some)
    }

    /// 处理语义层
    async fn process_semantic_layer(
        &self,
        screenshot: &DynamicImage,
        request: &OuvRequest,
    ) -> Result<Option<SemanticOutput>, OuvError> {
        if !self.config.enable_semantic {
            return Ok(None);
        }
        
        let layer = self.semantic_layer.read().await;
        layer.process(screenshot, &request.instruction).await.map(Some)
    }

    /// 融合结果
    async fn fuse_results(
        &self,
        pixel: &Option<PixelOutput>,
        feature: &Option<FeatureOutput>,
        semantic: &Option<SemanticOutput>,
        _request: &OuvRequest,
    ) -> Result<FusionResult, OuvError> {
        // 构建推荐元素列表
        let mut recommended_elements = Vec::new();
        
        if let Some(feat) = feature {
            for element in &feat.ui_elements {
                let relevance = self.calculate_element_relevance(element, semantic);
                recommended_elements.push(RecommendedElement {
                    element_id: element.id.clone(),
                    element_type: element.element_type.clone(),
                    bbox: element.bbox,
                    relevance_score: relevance,
                    relevance_reason: format!("Detected as {:?}", element.element_type),
                });
            }
        }
        
        // 按相关性排序
        recommended_elements.sort_by(|a, b| {
            b.relevance_score.partial_cmp(&a.relevance_score).unwrap()
        });
        
        // 计算综合置信度
        let confidence = self.calculate_fusion_confidence(pixel, feature, semantic);
        
        // 生成操作建议
        let actionable_suggestions = self.generate_suggestions(semantic, &recommended_elements);
        
        // 场景摘要
        let scene_summary = semantic
            .as_ref()
            .map(|s| s.scene_description.clone())
            .unwrap_or_default();
        
        Ok(FusionResult {
            confidence,
            recommended_elements,
            scene_summary,
            actionable_suggestions,
            layer_consistency: 0.85, // TODO: 计算真实一致性
        })
    }

    /// 计算元素相关性
    fn calculate_element_relevance(
        &self,
        element: &UiElement,
        semantic: &Option<SemanticOutput>,
    ) -> f32 {
        let base_score = element.confidence;
        
        // 如果有语义理解，结合意图
        if let Some(sem) = semantic {
            for intent in &sem.detected_intents {
                if let Some(target) = &intent.target {
                    if element.content.as_ref() == Some(target) ||
                       element.attributes.name.as_ref() == Some(target) {
                        return base_score * (1.0 + intent.confidence);
                    }
                }
            }
        }
        
        base_score
    }

    /// 计算融合置信度
    fn calculate_fusion_confidence(
        &self,
        _pixel: &Option<PixelOutput>,
        feature: &Option<FeatureOutput>,
        semantic: &Option<SemanticOutput>,
    ) -> f32 {
        let mut scores = Vec::new();
        
        if let Some(f) = feature {
            scores.push(f.confidence_stats.mean);
        }
        
        if let Some(s) = semantic {
            scores.push(s.confidence);
        }
        
        if scores.is_empty() {
            return 0.0;
        }
        
        scores.iter().sum::<f32>() / scores.len() as f32
    }

    /// 生成操作建议
    fn generate_suggestions(
        &self,
        semantic: &Option<SemanticOutput>,
        elements: &[RecommendedElement],
    ) -> Vec<ActionSuggestion> {
        let mut suggestions = Vec::new();
        
        if let Some(sem) = semantic {
            if let Some(action) = &sem.predicted_action {
                suggestions.push(ActionSuggestion {
                    action: action.clone(),
                    priority: 1,
                    expected_outcome: "Execute predicted action".to_string(),
                });
            }
        }
        
        // 从推荐元素生成建议
        for (i, elem) in elements.iter().take(3).enumerate() {
            if elem.relevance_score > 0.5 {
                suggestions.push(ActionSuggestion {
                    action: PredictedAction {
                        action_type: ActionType::Click,
                        target_element_id: Some(elem.element_id.clone()),
                        target_coordinates: Some(elem.bbox.center()),
                        target_description: None,
                        parameters: serde_json::json!({}),
                        reasoning: format!("High relevance element: {:?}", elem.element_type),
                        confidence: elem.relevance_score,
                    },
                    priority: (i + 2) as i32,
                    expected_outcome: format!("Interact with {:?}", elem.element_type),
                });
            }
        }
        
        suggestions
    }
}

/// OUV 错误
#[derive(Debug, thiserror::Error)]
pub enum OuvError {
    #[error("Missing screenshot")]
    MissingScreenshot,
    
    #[error("Image error: {0}")]
    ImageError(String),
    
    #[error("Pixel layer error: {0}")]
    PixelLayerError(String),
    
    #[error("Feature layer error: {0}")]
    FeatureLayerError(String),
    
    #[error("Semantic layer error: {0}")]
    SemanticLayerError(String),
    
    #[error("Fusion error: {0}")]
    FusionError(String),
}

// Base64 utilities
mod base64 {
    pub fn decode(input: &str) -> Result<Vec<u8>, base64::DecodeError> {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.decode(input)
    }
}

// Layer implementations (stubs)
pub mod pixel_layer {
    use super::*;
    
    pub struct PixelLayer;
    
    impl PixelLayer {
        pub fn new(_config: &OuvConfig) -> Result<Self, OuvError> {
            Ok(Self)
        }
        
        pub async fn process(&self, screenshot: &DynamicImage) -> Result<PixelOutput, OuvError> {
            Ok(PixelOutput {
                dimensions: (screenshot.width(), screenshot.height()),
                region: None,
                processed_image: None,
                image_hash: "placeholder".to_string(),
                compression_ratio: 1.0,
            })
        }
    }
}

pub mod feature_layer {
    use super::*;
    
    pub struct FeatureLayer;
    
    impl FeatureLayer {
        pub fn new(_config: &OuvConfig) -> Result<Self, OuvError> {
            Ok(Self)
        }
        
        pub async fn process(&self, _screenshot: &DynamicImage) -> Result<FeatureOutput, OuvError> {
            Ok(FeatureOutput {
                text_blocks: vec![],
                ui_elements: vec![],
                icons: vec![],
                processing_time_ms: 0,
                confidence_stats: ConfidenceStats {
                    min: 0.0,
                    max: 0.0,
                    mean: 0.0,
                    median: 0.0,
                },
            })
        }
    }
}

pub mod semantic_layer {
    use super::*;
    
    pub struct SemanticLayer;
    
    impl SemanticLayer {
        pub fn new(_config: &OuvConfig) -> Result<Self, OuvError> {
            Ok(Self)
        }
        
        pub async fn process(
            &self,
            _screenshot: &DynamicImage,
            instruction: &str,
        ) -> Result<SemanticOutput, OuvError> {
            Ok(SemanticOutput {
                scene_description: format!("Processing: {}", instruction),
                detected_intents: vec![],
                predicted_action: None,
                confidence: 0.8,
                vlm_model: "placeholder".to_string(),
                processing_time_ms: 100,
                raw_response: "{}".to_string(),
            })
        }
    }
}
