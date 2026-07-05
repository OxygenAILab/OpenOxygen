//! 屏幕捕获模块
//!
//! 基于 Windows GDI 的屏幕捕获，支持全屏、活动窗口、指定区域
//! 当前为 stub 实现

use image::DynamicImage;
use serde::{Deserialize, Serialize};

/// 屏幕捕获器
pub struct ScreenCapture {
    primary_display: DisplayInfo,
}

/// 显示器信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayInfo {
    pub id: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub is_primary: bool,
    pub scale_factor: f32,
}

/// 截图模式
#[derive(Debug, Clone, Copy)]
pub enum CaptureMode {
    Fullscreen,
    ActiveWindow,
    Region {
        x: i32,
        y: i32,
        width: u32,
        height: u32,
    },
    Display(u32),
}

/// 截图结果
#[derive(Debug, Clone)]
pub struct CaptureResult {
    pub image: DynamicImage,
    pub mode: CaptureMode,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

impl ScreenCapture {
    /// 创建新的屏幕捕获器
    pub fn new() -> Result<Self, crate::GuiError> {
        Ok(Self {
            primary_display: DisplayInfo {
                id: 0,
                name: "Primary Display".to_string(),
                width: 1920,
                height: 1080,
                x: 0,
                y: 0,
                is_primary: true,
                scale_factor: 1.0,
            },
        })
    }

    /// 获取主显示器尺寸
    pub fn primary_size(&self) -> (u32, u32) {
        (self.primary_display.width, self.primary_display.height)
    }

    /// 捕获全屏
    pub async fn capture_fullscreen(&self) -> Result<DynamicImage, crate::GuiError> {
        self.capture(CaptureMode::Fullscreen).await
    }

    /// 捕获活动窗口
    pub async fn capture_active_window(&self) -> Result<DynamicImage, crate::GuiError> {
        self.capture(CaptureMode::ActiveWindow).await
    }

    /// 捕获指定区域
    pub async fn capture_region(
        &self,
        x: i32,
        y: i32,
        width: u32,
        height: u32,
    ) -> Result<DynamicImage, crate::GuiError> {
        self.capture(CaptureMode::Region { x, y, width, height })
            .await
    }

    /// 执行截图
    pub async fn capture(&self, _mode: CaptureMode) -> Result<DynamicImage, crate::GuiError> {
        Err(crate::GuiError::CaptureError(
            "Screen capture not yet implemented (stub)".to_string(),
        ))
    }

    /// 编码为 PNG 字节
    pub fn encode_png(image: &DynamicImage) -> Result<Vec<u8>, crate::GuiError> {
        let mut buffer = Vec::new();
        image.write_to(&mut std::io::Cursor::new(&mut buffer), image::ImageFormat::Png)?;
        Ok(buffer)
    }

    /// 获取所有显示器
    pub async fn get_displays(&self) -> Result<Vec<DisplayInfo>, crate::GuiError> {
        Ok(vec![self.primary_display.clone()])
    }
}

impl Default for ScreenCapture {
    fn default() -> Self {
        Self::new().expect("Failed to create screen capture")
    }
}
