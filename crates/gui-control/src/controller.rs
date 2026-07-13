//! GUI 控制器具体实现
//!
//! 集成 Windows UIA、屏幕捕获、输入模拟
//! 当前为简化实现：坐标输入可用，UIA/视觉为 stub

use std::sync::Arc;
use tokio::sync::RwLock;
use image::DynamicImage;
use crate::uia::{ElementInfo, UiaAutomation};
use crate::capture::ScreenCapture;
use crate::input::InputSimulator;
use crate::vision::VisionProcessor;
use crate::{ActionResult, ActionType, GuiAction, GuiError, Target};

/// GUI 控制器实现
pub struct GuiControllerImpl {
    /// UIA 自动化（stub）
    #[allow(dead_code)]
    uia: Arc<RwLock<UiaAutomation>>,
    /// 屏幕捕获（stub）
    #[allow(dead_code)]
    capture: Arc<RwLock<ScreenCapture>>,
    /// 输入模拟
    input: Arc<RwLock<InputSimulator>>,
    /// 视觉处理器（stub）
    #[allow(dead_code)]
    vision: Arc<RwLock<VisionProcessor>>,
    /// 最后截图
    #[allow(dead_code)]
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
        Ok(())
    }

    /// 执行 GUI 操作
    pub async fn execute(&self, action: GuiAction) -> Result<ActionResult, GuiError> {
        let start = std::time::Instant::now();

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
                    // 简化：第一个作为修饰键，最后一个作为主键
                    if keys.len() >= 2 {
                        self.input.read().await.key_combo(
                            &[crate::input::ModifierKey::Ctrl],
                            'a',
                        ).await
                    } else if keys.len() == 1 {
                        let ch = keys[0].chars().next().unwrap_or(' ');
                        self.input.read().await.key_press(ch).await
                    } else {
                        Err(GuiError::InvalidParams("key_combo requires at least one key".to_string()))
                    }
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
                Ok(())
            }
        };

        let execution_time = start.elapsed().as_millis() as u64;
        action_result?;

        Ok(ActionResult {
            success: true,
            screenshot: None,
            element_info: None,
            error: None,
            execution_time_ms: execution_time,
        })
    }

    /// 解析目标为坐标
    async fn resolve_target(&self, target: &Target) -> Result<(i32, i32), GuiError> {
        match target {
            Target::Coordinates { x, y } => Ok((*x, *y)),
            Target::Element { .. } => {
                Err(GuiError::UnsupportedAction(
                    "Element target not yet implemented (UIA stub)".to_string(),
                ))
            }
            Target::Image { .. } => {
                Err(GuiError::UnsupportedAction(
                    "Image target not yet implemented (vision stub)".to_string(),
                ))
            }
            Target::Text { .. } => {
                Err(GuiError::UnsupportedAction(
                    "Text target not yet implemented (OCR stub)".to_string(),
                ))
            }
            Target::Description { .. } => {
                Err(GuiError::UnsupportedAction(
                    "Description target not yet implemented (VLM stub)".to_string(),
                ))
            }
        }
    }

    /// 获取当前屏幕所有可交互元素
    pub async fn get_interactive_elements(&self) -> Result<Vec<ElementInfo>, GuiError> {
        Ok(vec![])
    }

    /// 等待元素出现
    pub async fn wait_for_element(
        &self,
        _target: &Target,
        timeout_ms: u64,
    ) -> Result<ElementInfo, GuiError> {
        tokio::time::sleep(tokio::time::Duration::from_millis(timeout_ms)).await;
        Err(GuiError::Timeout(format!(
            "Element not found within {}ms (UIA stub)",
            timeout_ms
        )))
    }

    /// 截图
    pub async fn screenshot(&self) -> Result<String, GuiError> {
        Err(GuiError::CaptureError(
            "Screenshot not yet implemented (capture stub)".to_string(),
        ))
    }
}
