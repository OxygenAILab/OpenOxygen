//! Windows GUI 控制器具体实现

use std::sync::Arc;
use tokio::sync::Mutex;
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, SetCursorPos, mouse_event, keybd_event,
    MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
    MOUSEEVENTF_MOVE, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_VIRTUALDESK,
    MOUSEEVENTF_WHEEL, KEYEVENTF_KEYUP, VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN,
    GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{INPUT, INPUT_TYPE, MOUSEINPUT, KEYBDINPUT};
use windows::Win32::Graphics::Gdi::{GetDC, ReleaseDC, BitBlt, SRCCOPY, CreateCompatibleDC, CreateCompatibleBitmap, SelectObject, DeleteDC, DeleteObject, GetDIBits, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS};
use windows::Win32::System::Threading::GetCurrentProcessId;
use image::{DynamicImage, ImageBuffer, Rgba};

use super::uia::{UiaAutomation, ElementInfo, FindCondition};
use crate::executor::{GuiController, GuiResult, ElementInfo as ExecutorElementInfo, ExecutionError};

/// Windows GUI 控制器
pub struct WindowsGuiController {
    uia: Arc<Mutex<UiaAutomation>>,
    screen_width: i32,
    screen_height: i32,
}

impl WindowsGuiController {
    pub fn new() -> Result<Self, ExecutionError> {
        let uia = UiaAutomation::new()
            .map_err(|e| ExecutionError::GuiError(e.to_string()))?;
        
        unsafe {
            let screen_width = GetSystemMetrics(SM_CXSCREEN);
            let screen_height = GetSystemMetrics(SM_CYSCREEN);
            
            Ok(Self {
                uia: Arc::new(Mutex::new(uia)),
                screen_width,
                screen_height,
            })
        }
    }
    
    /// 确保坐标在屏幕范围内
    fn clamp_coordinates(&self, x: i32, y: i32) -> (i32, i32) {
        (
            x.clamp(0, self.screen_width),
            y.clamp(0, self.screen_height),
        )
    }
}

#[async_trait::async_trait]
impl GuiController for WindowsGuiController {
    async fn click(&self, x: i32, y: i32) -> Result<GuiResult, ExecutionError> {
        let (x, y) = self.clamp_coordinates(x, y);
        
        unsafe {
            // 移动到位置
            SetCursorPos(x, y)?;
            
            // 按下
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
            
            // 短暂延迟
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
            
            // 释放
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
        }
        
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        
        Ok(GuiResult {
            success: true,
            screenshot_before: None,
            screenshot_after: None,
            element_info: None,
            action_description: format!("Clicked at ({}, {})", x, y),
            execution_time_ms: 150,
            error: None,
        })
    }
    
    async fn double_click(&self, x: i32, y: i32) -> Result<GuiResult, ExecutionError> {
        self.click(x, y).await?;
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        self.click(x, y).await
    }
    
    async fn right_click(&self, x: i32, y: i32) -> Result<GuiResult, ExecutionError> {
        let (x, y) = self.clamp_coordinates(x, y);
        
        unsafe {
            SetCursorPos(x, y)?;
            mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
            mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
        }
        
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        
        Ok(GuiResult {
            success: true,
            screenshot_before: None,
            screenshot_after: None,
            element_info: None,
            action_description: format!("Right-clicked at ({}, {})", x, y),
            execution_time_ms: 150,
            error: None,
        })
    }
    
    async fn type_text(&self, text: &str) -> Result<GuiResult, ExecutionError> {
        for ch in text.chars() {
            self.send_char(ch).await?;
            tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
        }
        
        Ok(GuiResult {
            success: true,
            screenshot_before: None,
            screenshot_after: None,
            element_info: None,
            action_description: format!("Typed {} characters", text.len()),
            execution_time_ms: (text.len() * 20) as u64,
            error: None,
        })
    }
    
    async fn key_press(&self, key: &str) -> Result<GuiResult, ExecutionError> {
        let vk = match key.to_lowercase().as_str() {
            "enter" | "return" => 0x0D,
            "esc" | "escape" => 0x1B,
            "tab" => 0x09,
            "space" => 0x20,
            "backspace" => 0x08,
            "delete" => 0x2E,
            "up" => 0x26,
            "down" => 0x28,
            "left" => 0x25,
            "right" => 0x27,
            "home" => 0x24,
            "end" => 0x23,
            "pgup" => 0x21,
            "pgdn" => 0x22,
            "f1" => 0x70,
            "f2" => 0x71,
            "f3" => 0x72,
            "f4" => 0x73,
            "f5" => 0x74,
            "f6" => 0x75,
            "f7" => 0x76,
            "f8" => 0x77,
            "f9" => 0x78,
            "f10" => 0x79,
            "f11" => 0x7A,
            "f12" => 0x7B,
            _ => key.chars().next().unwrap_or(0) as u16,
        };
        
        unsafe {
            keybd_event(vk as u8, 0, Default::default(), 0);
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
            keybd_event(vk as u8, 0, KEYEVENTF_KEYUP, 0);
        }
        
        Ok(GuiResult {
            success: true,
            screenshot_before: None,
            screenshot_after: None,
            element_info: None,
            action_description: format!("Pressed key: {}", key),
            execution_time_ms: 50,
            error: None,
        })
    }
    
    async fn scroll(&self, delta: i32) -> Result<GuiResult, ExecutionError> {
        unsafe {
            mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (delta * 120) as u32, 0);
        }
        
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        
        Ok(GuiResult {
            success: true,
            screenshot_before: None,
            screenshot_after: None,
            element_info: None,
            action_description: format!("Scrolled by {}", delta),
            execution_time_ms: 100,
            error: None,
        })
    }
    
    async fn drag(&self, from: (i32, i32), to: (i32, i32)) -> Result<GuiResult, ExecutionError> {
        let (from_x, from_y) = self.clamp_coordinates(from.0, from.1);
        let (to_x, to_y) = self.clamp_coordinates(to.0, to.1);
        
        unsafe {
            // 移动到起点
            SetCursorPos(from_x, from_y)?;
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
            
            // 平滑移动
            let steps = 20;
            for i in 1..=steps {
                let x = from_x + ((to_x - from_x) * i as i32 / steps);
                let y = from_y + ((to_y - from_y) * i as i32 / steps);
                SetCursorPos(x, y)?;
                tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
            }
            
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
        }
        
        Ok(GuiResult {
            success: true,
            screenshot_before: None,
            screenshot_after: None,
            element_info: None,
            action_description: format!("Dragged from ({}, {}) to ({}, {})", from_x, from_y, to_x, to_y),
            execution_time_ms: 300,
            error: None,
        })
    }
    
    async fn screenshot(&self) -> Result<String, ExecutionError> {
        unsafe {
            let width = self.screen_width;
            let height = self.screen_height;
            
            // 获取屏幕DC
            let screen_dc = GetDC(None);
            let mem_dc = CreateCompatibleDC(screen_dc);
            let bitmap = CreateCompatibleBitmap(screen_dc, width, height);
            let old_bitmap = SelectObject(mem_dc, bitmap);
            
            // 复制屏幕
            BitBlt(mem_dc, 0, 0, width, height, screen_dc, 0, 0, SRCCOPY)?;
            
            // 获取位图数据
            let mut bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    biHeight: -height, // 自顶向下
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: 0,
                    biSizeImage: 0,
                    biXPelsPerMeter: 0,
                    biYPelsPerMeter: 0,
                    biClrUsed: 0,
                    biClrImportant: 0,
                },
                bmiColors: [Default::default(); 1],
            };
            
            let mut buffer = vec![0u8; (width * height * 4) as usize];
            GetDIBits(
                mem_dc,
                bitmap,
                0,
                height as u32,
                Some(buffer.as_mut_ptr() as *mut _),
                &mut bmi,
                DIB_RGB_COLORS,
            );
            
            // 清理
            SelectObject(mem_dc, old_bitmap)?;
            DeleteObject(bitmap)?;
            DeleteDC(mem_dc)?;
            ReleaseDC(None, screen_dc)?;
            
            // 创建图像
            let img = ImageBuffer::<Rgba<u8>, _>::from_raw(
                width as u32,
                height as u32,
                buffer,
            ).ok_or_else(|| ExecutionError::GuiError("Failed to create image".to_string()))?;
            
            // 编码为PNG
            let dynamic = DynamicImage::ImageRgba8(img);
            let mut png_data = Vec::new();
            dynamic.write_to(&mut std::io::Cursor::new(&mut png_data), image::ImageFormat::Png)
                .map_err(|e| ExecutionError::GuiError(e.to_string()))?;
            
            // Base64编码
            Ok(base64::encode(&png_data))
        }
    }
    
    async fn get_element_at(&self, x: i32, y: i32) -> Result<ExecutorElementInfo, ExecutionError> {
        let uia = self.uia.lock().await;
        let element = uia.get_element_at(x, y)
            .map_err(|e| ExecutionError::GuiError(e.to_string()))?;
        
        let info = uia.get_element_info(&element)
            .map_err(|e| ExecutionError::GuiError(e.to_string()))?;
        
        Ok(convert_element_info(info))
    }
    
    async fn find_element(&self, description: &str) -> Result<ExecutorElementInfo, ExecutionError> {
        let uia = self.uia.lock().await;
        
        // 尝试通过名称查找
        let condition = FindCondition {
            name: Some(description.to_string()),
            automation_id: None,
            class_name: None,
            control_type: None,
            contains_text: None,
        };
        
        let element = uia.find_element(&condition)
            .map_err(|e| ExecutionError::ElementNotFound(e.to_string()))?;
        
        let info = uia.get_element_info(&element)
            .map_err(|e| ExecutionError::GuiError(e.to_string()))?;
        
        Ok(convert_element_info(info))
    }
    
    async fn wait_for_element(&self, description: &str, timeout_ms: u64) -> Result<ExecutorElementInfo, ExecutionError> {
        let start = std::time::Instant::now();
        
        loop {
            if start.elapsed().as_millis() as u64 > timeout_ms {
                return Err(ExecutionError::Timeout(
                    format!("Element '{}' not found within {}ms", description, timeout_ms)
                ));
            }
            
            match self.find_element(description).await {
                Ok(element) => return Ok(element),
                Err(_) => {
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                }
            }
        }
    }
}

impl WindowsGuiController {
    /// 发送字符
    async fn send_char(&self, ch: char) -> Result<(), ExecutionError> {
        if ch.is_ascii() {
            let vk = ch.to_ascii_uppercase() as u16;
            unsafe {
                keybd_event(vk as u8, 0, Default::default(), 0);
                tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
                keybd_event(vk as u8, 0, KEYEVENTF_KEYUP, 0);
            }
        }
        Ok(())
    }
}

/// 转换元素信息
fn convert_element_info(info: ElementInfo) -> ExecutorElementInfo {
    ExecutorElementInfo {
        id: Some(info.id),
        name: info.name,
        control_type: format!("{:?}", info.control_type),
        bounds: (info.bounds.x, info.bounds.y, info.bounds.width, info.bounds.height),
        center: (info.center.x, info.center.y),
        value: info.value,
        is_enabled: info.is_enabled,
        is_visible: info.is_visible,
    }
}

// Base64编码
mod base64 {
    pub fn encode<T: AsRef<[u8]>>(input: T) -> String {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(input.as_ref())
    }
}

use std::default::Default;
