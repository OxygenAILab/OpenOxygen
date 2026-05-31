//! 输入模拟模块
//! 
//! 模拟鼠标和键盘输入

use serde::{Deserialize, Serialize};

/// 输入模拟器
pub struct InputSimulator;

/// 鼠标按钮
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

/// 键盘修饰键
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModifierKey {
    Ctrl,
    Alt,
    Shift,
    Win,
}

/// 按键定义
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Key {
    Named(String),
    Char(char),
    Code(u16),
}

impl InputSimulator {
    /// 创建新的输入模拟器
    pub fn new() -> Result<Self, crate::GuiError> {
        Ok(Self)
    }

    /// 移动鼠标
    pub async fn move_to(&self, x: i32, y: i32) -> Result<(), crate::GuiError> {
        #[cfg(target_os = "windows")]
        {
            use windows::Win32::Foundation::POINT;
            use windows::Win32::UI::WindowsAndMessaging;
            
            unsafe {
                WindowsAndMessaging::SetCursorPos(x, y)?;
            }
            Ok(())
        }
        
        #[cfg(not(target_os = "windows"))]
        {
            Err(crate::GuiError::InputError(
                "Platform not supported".to_string()
            ))
        }
    }

    /// 鼠标点击
    pub async fn click(&self, x: i32, y: i32) -> Result<(), crate::GuiError> {
        self.click_with_button(x, y, MouseButton::Left).await
    }

    /// 双击
    pub async fn double_click(&self, x: i32, y: i32) -> Result<(), crate::GuiError> {
        self.click(x, y).await?;
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        self.click(x, y).await
    }

    /// 右键点击
    pub async fn right_click(&self, x: i32, y: i32) -> Result<(), crate::GuiError> {
        self.click_with_button(x, y, MouseButton::Right).await
    }

    /// 使用指定按钮点击
    pub async fn click_with_button(
        &self, 
        x: i32, 
        y: i32, 
        button: MouseButton
    ) -> Result<(), crate::GuiError> {
        self.move_to(x, y).await?;
        
        #[cfg(target_os = "windows")]
        {
            use windows::Win32::UI::Input::KeyboardAndMouse::{
                MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
                MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
                MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP,
                mouse_event,
            };
            
            unsafe {
                let (down_flag, up_flag) = match button {
                    MouseButton::Left => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
                    MouseButton::Right => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
                    MouseButton::Middle => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
                };
                
                mouse_event(down_flag, 0, 0, 0, 0);
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                mouse_event(up_flag, 0, 0, 0, 0);
            }
            Ok(())
        }
        
        #[cfg(not(target_os = "windows"))]
        {
            Err(crate::GuiError::InputError(
                "Platform not supported".to_string()
            ))
        }
    }

    /// 输入文本
    pub async fn type_text(&self, text: &str) -> Result<(), crate::GuiError> {
        for ch in text.chars() {
            self.key_press(ch).await?;
            tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
        }
        Ok(())
    }

    /// 按下按键
    pub async fn key_press(&self, key: char) -> Result<(), crate::GuiError> {
        #[cfg(target_os = "windows")]
        {
            use windows::Win32::UI::Input::KeyboardAndMouse::{
                KEYBD_EVENT_FLAGS, VIRTUAL_KEY, keybd_event,
            };
            
            unsafe {
                let vk = VIRTUAL_KEY(key as u16);
                keybd_event(vk, 0, KEYBD_EVENT_FLAGS(0), 0);
                tokio::time::sleep(tokio::time::Duration::from_millis(30)).await;
                keybd_event(vk, 0, KEYBD_EVENT_FLAGS(2), 0); // KEYEVENTF_KEYUP
            }
            Ok(())
        }
        
        #[cfg(not(target_os = "windows"))]
        {
            Err(crate::GuiError::InputError(
                "Platform not supported".to_string()
            ))
        }
    }

    /// 组合键
    pub async fn key_combo(
        &self, 
        modifiers: &[ModifierKey], 
        key: char
    ) -> Result<(), crate::GuiError> {
        #[cfg(target_os = "windows")]
        {
            use windows::Win32::UI::Input::KeyboardAndMouse::{
                VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN,
                KEYBD_EVENT_FLAGS, keybd_event,
            };
            
            unsafe {
                // 按下修饰键
                for modifier in modifiers {
                    let vk = match modifier {
                        ModifierKey::Ctrl => VK_CONTROL,
                        ModifierKey::Alt => VK_MENU,
                        ModifierKey::Shift => VK_SHIFT,
                        ModifierKey::Win => VK_LWIN,
                    };
                    keybd_event(vk, 0, KEYBD_EVENT_FLAGS(0), 0);
                }
                
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                
                // 按下并释放主键
                keybd_event(VIRTUAL_KEY(key as u16), 0, KEYBD_EVENT_FLAGS(0), 0);
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                keybd_event(VIRTUAL_KEY(key as u16), 0, KEYBD_EVENT_FLAGS(2), 0);
                
                // 释放修饰键
                for modifier in modifiers.iter().rev() {
                    let vk = match modifier {
                        ModifierKey::Ctrl => VK_CONTROL,
                        ModifierKey::Alt => VK_MENU,
                        ModifierKey::Shift => VK_SHIFT,
                        ModifierKey::Win => VK_LWIN,
                    };
                    keybd_event(vk, 0, KEYBD_EVENT_FLAGS(2), 0);
                }
            }
            Ok(())
        }
        
        #[cfg(not(target_os = "windows"))]
        {
            Err(crate::GuiError::InputError(
                "Platform not supported".to_string()
            ))
        }
    }

    /// 滚动
    pub async fn scroll(&self, x: i32, y: i32, delta: i32) -> Result<(), crate::GuiError> {
        self.move_to(x, y).await?;
        
        #[cfg(target_os = "windows")]
        {
            use windows::Win32::UI::Input::KeyboardAndMouse::{
                MOUSEEVENTF_WHEEL, mouse_event,
            };
            
            unsafe {
                mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta as u32 * 120, 0);
            }
            Ok(())
        }
        
        #[cfg(not(target_os = "windows"))]
        {
            Err(crate::GuiError::InputError(
                "Platform not supported".to_string()
            ))
        }
    }

    /// 拖拽
    pub async fn drag(&self, from: (i32, i32), to: (i32, i32)) -> Result<(), crate::GuiError> {
        #[cfg(target_os = "windows")]
        {
            use windows::Win32::UI::Input::KeyboardAndMouse::{
                MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, mouse_event,
            };
            
            unsafe {
                // 移动到起点并按下
                self.move_to(from.0, from.1).await?;
                mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                
                // 平滑移动到终点
                let steps = 20;
                let dx = (to.0 - from.0) as f32 / steps as f32;
                let dy = (to.1 - from.1) as f32 / steps as f32;
                
                for i in 1..=steps {
                    let x = from.0 + (dx * i as f32) as i32;
                    let y = from.1 + (dy * i as f32) as i32;
                    self.move_to(x, y).await?;
                    tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
                }
                
                // 释放
                mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
            }
            Ok(())
        }
        
        #[cfg(not(target_os = "windows"))]
        {
            Err(crate::GuiError::InputError(
                "Platform not supported".to_string()
            ))
        }
    }
}

impl Default for InputSimulator {
    fn default() -> Self {
        Self::new().expect("Failed to create input simulator")
    }
}

// Windows 类型别名
#[cfg(target_os = "windows")]
use windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY;
