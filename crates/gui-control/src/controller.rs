//! GUI 控制器具体实现
//! 
//! 集成 Windows UIA、屏幕捕获、输入模拟

use std::sync::Arc;
use tokio::sync::RwLock;
use image::DynamicImage;
use crate::uia::{UiaAutomation, ElementInfo, FindCondition, ControlType, Rect, Point};
use crate::capture::ScreenCapture;
use crate::input::InputSimulator;
use crate::vision::VisionProcessor;
use crate::{GuiAction, ActionType, Target, ActionParams, ActionResult, GuiError};

/// GUI 控制器实现
pub struct GuiControllerImpl {
    /// UIA 自动化
    uia: Arc<RwLock<UiaAutomation>>,
    /// 屏幕捕获
    capture: Arc<RwLock<ScreenCapture>>,
    /// 输入模拟
    input: Arc<RwLock<InputSimulator>>,
    /// 视觉处理器
    vision: Arc<RwLock<VisionProcessor>>,
    /// 最后截图
    last_screenshot: Arc<RwLock<Option<DynamicImage>>>,
}

impl GuiControllerImpl {
    /// 创建新的 GUI 控制器
    pub fn new() -> Result<Self, GuiError> {
        Ok(Self {
            uia: Arc::new(RwLock::new(UiaAutomation::new()?)),
            capture: Arc::new(RwLock::new(ScreenCapture::new()?)),
            input: Arc::new(RwLock::new(InputSimulator::new()?)),
            vision: Arc::new(RwLock::new(VisionProcessor::new()?)),
            last_screenshot: Arc::new(RwLock::new(None)),
        })
    }

    /// 初始化
    pub async fn initialize(&self) -> Result<(), GuiError> {
        // 预热 UIA
        let uia = self.uia.read().await;
        let _ = uia.get_desktop();
        Ok(())
    }

    /// 执行 GUI 操作
    pub async fn execute(&self, action: GuiAction) -> Result<ActionResult, GuiError> {
        let start = std::time::Instant::now();

        // 截图（操作前）
        let screenshot_before = self.capture.read().await.capture_fullscreen().await.ok();
        *self.last_screenshot.write().await = screenshot_before.clone();

        // 解析目标
        let target_coords = self.resolve_target(&action.target).await?;

        // 执行动作
        let action_result = match action.action_type {
            ActionType::Click => {
                self.input.read().await.click(target_coords.0, target_coords.1).await
            }
            ActionType::DoubleClick => {
                self.input.read().await.double_click(target_coords.0, target_coords.1).await
            }
            ActionType::RightClick => {
                self.input.read().await.right_click(target_coords.0, target_coords.1).await
            }
            ActionType::Type => {
                if let Some(text) = &action.params.text {
                    // 如果指定了坐标，先点击
                    if target_coords != (0, 0) {
                        self.input.read().await.click(target_coords.0, target_coords.1).await?;
                    }
                    self.input.read().await.type_text(text).await
                } else {
                    Err(GuiError::InvalidParams("type action requires text".to_string()))
                }
            }
            ActionType::KeyCombo => {
                if let Some(keys) = &action.params.keys {
                    let keys: Vec<&str> = keys.iter().map(|s| s.as_str()).collect();
                    self.input.read().await.key_combo(&keys).await
                } else {
                    Err(GuiError::InvalidParams("key_combo requires keys".to_string()))
                }
            }
            ActionType::Scroll => {
                let delta = action.params.offset.map(|o| o.1).unwrap_or(100);
                self.input.read().await.scroll(target_coords.0, target_coords.1, delta).await
            }
            ActionType::Drag => {
                if let Some(offset) = action.params.offset {
                    let to = (target_coords.0 + offset.0, target_coords.1 + offset.1);
                    self.input.read().await.drag((target_coords.0, target_coords.1), to).await
                } else {
                    Err(GuiError::InvalidParams("drag requires offset".to_string()))
                }
            }
            ActionType::Hover => {
                self.input.read().await.move_to(target_coords.0, target_coords.1).await
            }
            ActionType::Wait => {
                let duration = action.params.duration_ms.unwrap_or(1000);
                tokio::time::sleep(tokio::time::Duration::from_millis(duration)).await;
                Ok(())
            }
            ActionType::Screenshot => {
                // 专门处理截图
                Ok(())
            }
        };

        // 短暂延迟等待 UI 更新
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        // 截图（操作后）
        let screenshot_after = self.capture.read().await.capture_fullscreen().await.ok();
        *self.last_screenshot.write().await = screenshot_after.clone();

        // 编码截图
        let screenshot_after_b64 = screenshot_after.as_ref()
            .and_then(|img| encode_image_to_base64(img).ok());

        let execution_time = start.elapsed().as_millis() as u64;

        action_result?;

        Ok(ActionResult {
            success: true,
            screenshot: screenshot_after_b64,
            element_info: None,
            error: None,
            execution_time_ms: execution_time,
        })
    }

    /// 解析目标为坐标
    async fn resolve_target(&self, target: &Target) -> Result<(i32, i32), GuiError> {
        match target {
            Target::Coordinates { x, y } => Ok((*x, *y)),
            Target::Element { id, name, class } => {
                // 使用 UIA 查找元素
                let condition = FindCondition {
                    name: name.clone(),
                    automation_id: id.clone(),
                    class_name: class.clone(),
                    control_type: None,
                    contains_text: None,
                };

                let uia = self.uia.read().await;
                let element = uia.find_element(&condition)?;
                let info = uia.get_element_info(&element)?;
                Ok(info.center)
            }
            Target::Image { template, confidence } => {
                // 使用视觉匹配
                let screenshot = self.capture.read().await.capture_fullscreen().await?;
                let coords = self.vision.read().await.find_image_match(&screenshot, template, *confidence).await?;
                Ok(coords)
            }
            Target::Text { content, partial } => {
                // OCR 查找文本
                let screenshot = self.capture.read().await.capture_fullscreen().await?;
                let coords = self.vision.read().await.find_text(&screenshot, content, *partial).await?;
                Ok(coords)
            }
            Target::Description { desc } => {
                // LLM 引导的视觉定位
                let screenshot = self.capture.read().await.capture_fullscreen().await?;
                let coords = self.vision.read().await.locate_by_description(&screenshot, desc).await?;
                Ok(coords)
            }
        }
    }

    /// 获取当前屏幕所有可交互元素
    pub async fn get_interactive_elements(&self) -> Result<Vec<ElementInfo>, GuiError> {
        let uia = self.uia.read().await;
        uia.get_interactive_elements()
    }

    /// 等待元素出现
    pub async fn wait_for_element(
        &self,
        target: &Target,
        timeout_ms: u64,
    ) -> Result<ElementInfo, GuiError> {
        let start = std::time::Instant::now();

        while start.elapsed().as_millis() as u64 < timeout_ms {
            if let Ok(coords) = self.resolve_target(target).await {
                // 获取元素详情
                let uia = self.uia.read().await;
                if let Ok(element) = uia.get_element_at(coords.0, coords.1) {
                    return uia.get_element_info(&element);
                }
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }

        Err(GuiError::Timeout(format!("Element not found within {}ms", timeout_ms)))
    }

    /// 点击元素
    pub async fn click_element(&self, element: &ElementInfo) -> Result<ActionResult, GuiError> {
        self.execute(GuiAction {
            action_type: ActionType::Click,
            target: Target::Coordinates {
                x: element.center.0,
                y: element.center.1,
            },
            params: ActionParams::default(),
        }).await
    }

    /// 在元素上输入文本
    pub async fn type_on_element(&self, element: &ElementInfo, text: &str) -> Result<ActionResult, GuiError> {
        // 先点击聚焦
        self.click_element(element).await?;
        // 输入文本
        self.execute(GuiAction {
            action_type: ActionType::Type,
            target: Target::Coordinates { x: 0, y: 0 },
            params: ActionParams {
                text: Some(text.to_string()),
                ..Default::default()
            },
        }).await
    }

    /// 获取当前窗口元素
    pub async fn get_active_window_elements(&self) -> Result<Vec<ElementInfo>, GuiError> {
        let uia = self.uia.read().await;
        
        // 获取活动窗口
        let active = uia.get_active_window_element()?;
        let active_info = uia.get_element_info(&active)?;

        // 查找该窗口下的所有子元素
        let condition = FindCondition {
            name: None,
            automation_id: None,
            class_name: None,
            control_type: None,
            contains_text: None,
        };

        // 使用窗口句柄查找
        let all_elements = uia.find_elements(&condition, 1000)?;
        let mut window_elements = Vec::new();

        for element in all_elements {
            if let Ok(info) = uia.get_element_info(&element) {
                if info.process_id == active_info.process_id {
                    window_elements.push(info);
                }
            }
        }

        Ok(window_elements)
    }

    /// 截图
    pub async fn screenshot(&self) -> Result<String, GuiError> {
        let image = self.capture.read().await.capture_fullscreen().await?;
        encode_image_to_base64(&image)
    }

    /// 查找文本元素
    pub async fn find_text_element(&self, text: &str) -> Result<ElementInfo, GuiError> {
        let elements = self.get_interactive_elements().await?;
        
        for element in elements {
            if let Some(ref value) = element.value {
                if value.contains(text) {
                    return Ok(element);
                }
            }
            if element.name.contains(text) {
                return Ok(element);
            }
        }

        Err(GuiError::ElementNotFound(format!("Text '{}' not found", text)))
    }

    /// 滚动到元素
    pub async fn scroll_to_element(&self, element: &ElementInfo) -> Result<(), GuiError> {
        // 移动鼠标到元素位置并滚动
        self.input.read().await.move_to(element.center.0, element.center.1).await?;
        self.input.read().await.scroll(element.center.0, element.center.1, -300).await
    }

    /// 获取最后截图
    pub async fn get_last_screenshot(&self) -> Option<DynamicImage> {
        self.last_screenshot.read().await.clone()
    }

    /// 通过描述查找并点击（VLM 辅助）
    pub async fn find_and_click_by_description(&self, description: &str) -> Result<ActionResult, GuiError> {
        let screenshot = self.capture.read().await.capture_fullscreen().await?;
        let coords = self.vision.read().await.locate_by_description(&screenshot, description).await?;
        
        self.execute(GuiAction {
            action_type: ActionType::Click,
            target: Target::Coordinates { x: coords.0, y: coords.1 },
            params: ActionParams::default(),
        }).await
    }
}

/// 编码图像为 base64
fn encode_image_to_base64(image: &DynamicImage) -> Result<String, GuiError> {
    let mut buffer = Vec::new();
    image.write_to(&mut std::io::Cursor::new(&mut buffer), image::ImageFormat::Png)
        .map_err(|e| GuiError::CaptureError(e.to_string()))?;
    
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&buffer))
}
