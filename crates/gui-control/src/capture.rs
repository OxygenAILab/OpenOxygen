//! 屏幕捕获模块
//! 
//! 支持多种截图模式和区域选择

use image::{DynamicImage, ImageBuffer, Rgba};
use serde::{Deserialize, Serialize};
use std::io::Cursor;

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
    Region { x: i32, y: i32, width: u32, height: u32 },
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
            primary_display: Self::get_primary_display()?,
        })
    }

    /// 获取主显示器信息
    fn get_primary_display() -> Result<DisplayInfo, crate::GuiError> {
        // Windows 实现
        #[cfg(target_os = "windows")]
        {
            use windows::Win32::Graphics::Gdi;
            
            unsafe {
                let hdc = Gdi::GetDC(None);
                if hdc.is_invalid() {
                    return Err(crate::GuiError::CaptureError(
                        "Failed to get device context".to_string()
                    ));
                }
                
                let width = Gdi::GetDeviceCaps(hdc, Gdi::HORZRES) as u32;
                let height = Gdi::GetDeviceCaps(hdc, Gdi::VERTRES) as u32;
                
                Gdi::ReleaseDC(None, hdc);
                
                Ok(DisplayInfo {
                    id: 0,
                    name: "Primary Display".to_string(),
                    width,
                    height,
                    x: 0,
                    y: 0,
                    is_primary: true,
                    scale_factor: 1.0,
                })
            }
        }
        
        #[cfg(not(target_os = "windows"))]
        {
            Err(crate::GuiError::CaptureError(
                "Platform not supported".to_string()
            ))
        }
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
    pub async fn capture_region(&self, x: i32, y: i32, width: u32, height: u32) 
        -> Result<DynamicImage, crate::GuiError> {
        self.capture(CaptureMode::Region { x, y, width, height }).await
    }

    /// 执行截图
    pub async fn capture(&self, mode: CaptureMode) -> Result<DynamicImage, crate::GuiError> {
        #[cfg(target_os = "windows")]
        {
            self.capture_windows(mode).await
        }
        
        #[cfg(not(target_os = "windows"))]
        {
            Err(crate::GuiError::CaptureError(
                "Platform not supported".to_string()
            ))
        }
    }

    /// Windows 截图实现
    #[cfg(target_os = "windows")]
    async fn capture_windows(&self, mode: CaptureMode) -> Result<DynamicImage, crate::GuiError> {
        use windows::Win32::Foundation::{HWND, RECT};
        use windows::Win32::Graphics::Gdi::{self, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, SRCCOPY};
        use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect};
        
        unsafe {
            // 获取截图区域
            let (x, y, width, height) = match mode {
                CaptureMode::Fullscreen => {
                    (0, 0, self.primary_display.width, self.primary_display.height)
                }
                CaptureMode::ActiveWindow => {
                    let hwnd = GetForegroundWindow();
                    let mut rect = RECT::default();
                    GetWindowRect(hwnd, &mut rect)?;
                    (
                        rect.left,
                        rect.top,
                        (rect.right - rect.left) as u32,
                        (rect.bottom - rect.top) as u32,
                    )
                }
                CaptureMode::Region { x, y, width, height } => (x, y, width, height),
                CaptureMode::Display(_) => (0, 0, self.primary_display.width, self.primary_display.height),
            };

            // 创建设备上下文
            let screen_dc = Gdi::GetDC(None);
            if screen_dc.is_invalid() {
                return Err(crate::GuiError::CaptureError(
                    "Failed to get screen DC".to_string()
                ));
            }

            let memory_dc = Gdi::CreateCompatibleDC(Some(screen_dc));
            if memory_dc.is_invalid() {
                Gdi::ReleaseDC(None, screen_dc);
                return Err(crate::GuiError::CaptureError(
                    "Failed to create memory DC".to_string()
                ));
            }

            // 创建位图
            let bitmap = Gdi::CreateCompatibleBitmap(screen_dc, width as i32, height as i32);
            if bitmap.is_invalid() {
                Gdi::DeleteDC(memory_dc)?;
                Gdi::ReleaseDC(None, screen_dc);
                return Err(crate::GuiError::CaptureError(
                    "Failed to create bitmap".to_string()
                ));
            }

            let old_bitmap = Gdi::SelectObject(memory_dc, Gdi::HGDIOBJ(bitmap.0));
            
            // 复制屏幕内容
            Gdi::BitBlt(
                memory_dc,
                0, 0,
                width as i32, height as i32,
                Some(screen_dc),
                x, y,
                SRCCOPY,
            )?;

            // 获取位图数据
            let mut bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width as i32,
                    biHeight: -(height as i32), // 自顶向下
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: Gdi::BI_RGB.0,
                    biSizeImage: 0,
                    biXPelsPerMeter: 0,
                    biYPelsPerMeter: 0,
                    biClrUsed: 0,
                    biClrImportant: 0,
                },
                bmiColors: [Default::default(); 1],
            };

            let mut buffer = vec![0u8; (width * height * 4) as usize];
            Gdi::GetDIBits(
                memory_dc,
                bitmap,
                0,
                height,
                Some(buffer.as_mut_ptr() as *mut _),
                &mut bmi,
                DIB_RGB_COLORS,
            );

            // 清理资源
            Gdi::SelectObject(memory_dc, old_bitmap)?;
            Gdi::DeleteObject(Gdi::HGDIOBJ(bitmap.0))?;
            Gdi::DeleteDC(memory_dc)?;
            Gdi::ReleaseDC(None, screen_dc);

            // 创建图像
            let img = ImageBuffer::<Rgba<u8>, _>::from_raw(width, height, buffer)
                .ok_or_else(|| crate::GuiError::CaptureError(
                    "Failed to create image buffer".to_string()
                ))?;

            Ok(DynamicImage::ImageRgba8(img))
        }
    }

    /// 编码为 PNG 字节
    pub fn encode_png(image: &DynamicImage) -> Result<Vec<u8>, crate::GuiError> {
        let mut buffer = Cursor::new(Vec::new());
        image.write_to(&mut buffer, image::ImageFormat::Png)?;
        Ok(buffer.into_inner())
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
