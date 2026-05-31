//! Windows UIA (UI Automation) 集成
//! 
//! 基于 Microsoft UI Automation API

use std::sync::Arc;
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement,
    UIA_ControlTypePropertyId, UIA_NamePropertyId, UIA_AutomationIdPropertyId,
    UIA_BoundingRectanglePropertyId, UIA_ValueValuePropertyId,
    UIA_IsEnabledPropertyId, UIA_IsOffscreenPropertyId,
    UIA_HasKeyboardFocusPropertyId, UIA_ProcessIdPropertyId,
    UIA_ClassNamePropertyId, UIA_NativeWindowHandlePropertyId,
    TreeScope_Descendants, TreeScope_Children, TreeScope_Element,
    UIA_ButtonControlTypeId, UIA_EditControlTypeId, UIA_HyperlinkControlTypeId,
    UIA_ImageControlTypeId, UIA_ListControlTypeId, UIA_ListItemControlTypeId,
    UIA_MenuControlTypeId, UIA_MenuItemControlTypeId, UIA_WindowControlTypeId,
    UIA_TextControlTypeId, UIA_CheckBoxControlTypeId, UIA_RadioButtonControlTypeId,
    UIA_ComboBoxControlTypeId, UIA_TabControlTypeId, UIA_ScrollBarControlTypeId,
    IUIAutomationTreeWalker, UIA_PatternsAvailable,
};
use windows::Win32::Foundation::{HWND, RECT, POINT};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowRect, EnumWindows, IsWindowVisible,
    GetWindowTextW, GetWindowThreadProcessId,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_TYPE, MOUSEINPUT, KEYBDINPUT,
    MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
    MOUSEEVENTF_MOVE, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_VIRTUALDESK,
    KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN,
    VIRTUAL_KEY,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// UIA 自动化控制器
pub struct UiaAutomation {
    automation: IUIAutomation,
    desktop: IUIAutomationElement,
}

/// 元素信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ElementInfo {
    pub id: String,
    pub name: String,
    pub class_name: String,
    pub control_type: ControlType,
    pub automation_id: String,
    pub bounds: Rect,
    pub center: Point,
    pub value: Option<String>,
    pub is_enabled: bool,
    pub is_visible: bool,
    pub has_focus: bool,
    pub process_id: u32,
    pub window_handle: Option<isize>,
    pub children_count: usize,
}

/// 控制类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ControlType {
    Unknown,
    Button,
    Edit,
    Hyperlink,
    Image,
    List,
    ListItem,
    Menu,
    MenuItem,
    Window,
    Text,
    CheckBox,
    RadioButton,
    ComboBox,
    Tab,
    ScrollBar,
    Document,
    Group,
    Pane,
    ToolTip,
    Custom(String),
}

/// 矩形
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl Rect {
    pub fn center(&self) -> Point {
        Point {
            x: self.x + self.width / 2,
            y: self.y + self.height / 2,
        }
    }
}

/// 点
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

/// 查找条件
#[derive(Debug, Clone)]
pub struct FindCondition {
    pub name: Option<String>,
    pub automation_id: Option<String>,
    pub class_name: Option<String>,
    pub control_type: Option<ControlType>,
    pub contains_text: Option<String>,
}

/// UIA 错误
#[derive(Error, Debug)]
pub enum UiaError {
    #[error("Windows API error: {0}")]
    WindowsError(#[from] windows::core::Error),
    
    #[error("Element not found: {0}")]
    ElementNotFound(String),
    
    #[error("Multiple elements found: {0}")]
    MultipleElementsFound(String),
    
    #[error("Invalid coordinates: ({0}, {1})")]
    InvalidCoordinates(i32, i32),
    
    #[error("COM initialization failed")]
    ComInitFailed,
    
    #[error("Pattern not supported: {0}")]
    PatternNotSupported(String),
}

impl UiaAutomation {
    /// 初始化 UIA 自动化
    pub fn new() -> Result<Self, UiaError> {
        unsafe {
            // 初始化 COM
            CoInitializeEx(None, COINIT_MULTITHREADED)?;
            
            // 创建 UIA 实例
            let automation: IUIAutomation = CoCreateInstance(
                &CUIAutomation,
                None,
                CLSCTX_ALL,
            )?;
            
            // 获取桌面元素
            let desktop = automation.GetRootElement()?;
            
            Ok(Self {
                automation,
                desktop,
            })
        }
    }
    
    /// 获取桌面元素
    pub fn get_desktop(&self) -> &IUIAutomationElement {
        &self.desktop
    }
    
    /// 获取活动窗口元素
    pub fn get_active_window_element(&self) -> Result<IUIAutomationElement, UiaError> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0 == 0 {
                return Err(UiaError::ElementNotFound("No active window".to_string()));
            }
            
            self.automation.GetFocusedElement()
                .map_err(|e| UiaError::WindowsError(e))
        }
    }
    
    /// 查找元素
    pub fn find_element(&self, condition: &FindCondition) -> Result<IUIAutomationElement, UiaError> {
        let mut elements = self.find_elements(condition, 1)?;
        elements.pop()
            .ok_or_else(|| UiaError::ElementNotFound(format!("{:?}", condition)))
    }
    
    /// 查找多个元素
    pub fn find_elements(&self, condition: &FindCondition, max_results: i32) -> Result<Vec<IUIAutomationElement>, UiaError> {
        unsafe {
            let mut elements = Vec::new();
            
            // 构建 UIA 条件
            let uia_condition = self.build_condition(condition)?;
            
            // 查找元素
            let found_array = self.desktop.FindAll(TreeScope_Descendants, &uia_condition)?;
            let count = found_array.Length()?;
            
            let limit = (count as i32).min(max_results);
            for i in 0..limit {
                if let Ok(element) = found_array.GetElement(i as i32) {
                    elements.push(element);
                }
            }
            
            Ok(elements)
        }
    }
    
    /// 构建 UIA 条件
    unsafe fn build_condition(&self, condition: &FindCondition) -> Result<windows::Win32::UI::Accessibility::IUIAutomationCondition, UiaError> {
        // 简化实现：使用属性条件
        // 实际应支持复合条件（AndCondition, OrCondition）
        
        let mut conditions = Vec::new();
        
        if let Some(name) = &condition.name {
            let name_prop = self.automation.CreatePropertyCondition(
                UIA_NamePropertyId,
                &windows::core::VARIANT::from(name.as_str()),
                None,
            )?;
            conditions.push(name_prop);
        }
        
        if let Some(auto_id) = &condition.automation_id {
            let id_prop = self.automation.CreatePropertyCondition(
                UIA_AutomationIdPropertyId,
                &windows::core::VARIANT::from(auto_id.as_str()),
                None,
            )?;
            conditions.push(id_prop);
        }
        
        if let Some(class) = &condition.class_name {
            let class_prop = self.automation.CreatePropertyCondition(
                UIA_ClassNamePropertyId,
                &windows::core::VARIANT::from(class.as_str()),
                None,
            )?;
            conditions.push(class_prop);
        }
        
        if let Some(ctrl_type) = &condition.control_type {
            let type_id = control_type_to_uia(ctrl_type);
            let type_prop = self.automation.CreatePropertyCondition(
                UIA_ControlTypePropertyId,
                &windows::core::VARIANT::from(type_id as i32),
                None,
            )?;
            conditions.push(type_prop);
        }
        
        // 组合条件
        if conditions.is_empty() {
            // 返回真条件
            self.automation.CreateTrueCondition()
                .map_err(|e| UiaError::WindowsError(e))
        } else if conditions.len() == 1 {
            Ok(conditions.into_iter().next().unwrap())
        } else {
            // 创建 And 条件
            let condition_array: Vec<_> = conditions.iter().map(|c| c.clone().into()).collect();
            self.automation.CreateAndConditionFromArray(&condition_array)
                .map_err(|e| UiaError::WindowsError(e))
        }
    }
    
    /// 获取元素信息
    pub fn get_element_info(&self, element: &IUIAutomationElement) -> Result<ElementInfo, UiaError> {
        unsafe {
            let name = element.GetCurrentPropertyValue(UIA_NamePropertyId)?
                .to_string()
                .unwrap_or_default();
            
            let class_name = element.GetCurrentPropertyValue(UIA_ClassNamePropertyId)?
                .to_string()
                .unwrap_or_default();
            
            let auto_id = element.GetCurrentPropertyValue(UIA_AutomationIdPropertyId)?
                .to_string()
                .unwrap_or_default();
            
            let control_type_val: i32 = element.GetCurrentPropertyValue(UIA_ControlTypePropertyId)?
                .try_into()
                .unwrap_or(0);
            let control_type = uia_to_control_type(control_type_val);
            
            // 获取边界框
            let rect_variant = element.GetCurrentPropertyValue(UIA_BoundingRectanglePropertyId)?;
            let bounds = parse_rect(&rect_variant)?;
            let center = bounds.center();
            
            // 获取值（如果支持）
            let value = element.GetCurrentPropertyValue(UIA_ValueValuePropertyId)?
                .to_string()
                .ok();
            
            let is_enabled: bool = element.GetCurrentPropertyValue(UIA_IsEnabledPropertyId)?
                .try_into()
                .unwrap_or(true);
            
            let is_visible: bool = !element.GetCurrentPropertyValue(UIA_IsOffscreenPropertyId)?
                .try_into()
                .unwrap_or(true);
            
            let has_focus: bool = element.GetCurrentPropertyValue(UIA_HasKeyboardFocusPropertyId)?
                .try_into()
                .unwrap_or(false);
            
            let process_id: i32 = element.GetCurrentPropertyValue(UIA_ProcessIdPropertyId)?
                .try_into()
                .unwrap_or(0);
            
            let window_handle: isize = element.GetCurrentPropertyValue(UIA_NativeWindowHandlePropertyId)?
                .try_into()
                .unwrap_or(0);
            
            // 获取子元素数量
            let children = element.FindAll(TreeScope_Children, &self.automation.CreateTrueCondition()?)?;
            let children_count = children.Length()? as usize;
            
            Ok(ElementInfo {
                id: format!("{}_{}", process_id, auto_id),
                name,
                class_name,
                control_type,
                automation_id: auto_id,
                bounds,
                center,
                value,
                is_enabled,
                is_visible,
                has_focus,
                process_id: process_id as u32,
                window_handle: if window_handle != 0 { Some(window_handle) } else { None },
                children_count,
            })
        }
    }
    
    /// 获取元素在坐标处的元素
    pub fn get_element_at(&self, x: i32, y: i32) -> Result<IUIAutomationElement, UiaError> {
        unsafe {
            let point = POINT { x, y };
            self.automation.ElementFromPoint(point)
                .map_err(|e| UiaError::WindowsError(e))
        }
    }
    
    /// 获取所有可交互元素
    pub fn get_interactive_elements(&self) -> Result<Vec<ElementInfo>, UiaError> {
        unsafe {
            // 查找所有控件类型的元素
            let condition = self.automation.CreateTrueCondition()?;
            let elements = self.desktop.FindAll(TreeScope_Descendants, &condition)?;
            let count = elements.Length()?;
            
            let mut result = Vec::new();
            for i in 0..count {
                if let Ok(element) = elements.GetElement(i) {
                    if let Ok(info) = self.get_element_info(&element) {
                        // 只返回可见且启用的交互元素
                        if info.is_visible && info.is_enabled && is_interactive(&info.control_type) {
                            result.push(info);
                        }
                    }
                }
            }
            
            Ok(result)
        }
    }
    
    /// 获取窗口列表
    pub fn get_windows(&self) -> Result<Vec<WindowInfo>, UiaError> {
        unsafe {
            let mut windows = Vec::new();
            
            let enum_proc = |hwnd: HWND| -> bool {
                if IsWindowVisible(hwnd).as_bool() {
                    let mut text: [u16; 256] = [0; 256];
                    let len = GetWindowTextW(hwnd, &mut text);
                    if len > 0 {
                        let title = String::from_utf16_lossy(&text[..len as usize]);
                        let mut process_id: u32 = 0;
                        GetWindowThreadProcessId(hwnd, Some(&mut process_id));
                        
                        windows.push(WindowInfo {
                            handle: hwnd.0 as isize,
                            title: title.to_string(),
                            process_id,
                            rect: self.get_window_rect(hwnd).unwrap_or_default(),
                        });
                    }
                }
                true
            };
            
            EnumWindows(Some(enum_windows_callback), 0)?;
            
            Ok(windows)
        }
    }
    
    /// 获取窗口矩形
    unsafe fn get_window_rect(&self, hwnd: HWND) -> Result<Rect, UiaError> {
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect)?;
        
        Ok(Rect {
            x: rect.left,
            y: rect.top,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
        })
    }
    
    /// 点击元素
    pub fn click_element(&self, element: &IUIAutomationElement) -> Result<(), UiaError> {
        unsafe {
            // 获取元素中心
            let rect_variant = element.GetCurrentPropertyValue(UIA_BoundingRectanglePropertyId)?;
            let rect = parse_rect(&rect_variant)?;
            let center = rect.center();
            
            // 模拟点击
            self.click_at(center.x, center.y)
        }
    }
    
    /// 在坐标处点击
    pub fn click_at(&self, x: i32, y: i32) -> Result<(), UiaError> {
        unsafe {
            // 移动鼠标到位置
            let screen_width = GetSystemMetrics(SM_CXSCREEN);
            let screen_height = GetSystemMetrics(SM_CYSCREEN);
            
            // 转换为绝对坐标
            let abs_x = (x * 65535 / screen_width) as i32;
            let abs_y = (y * 65535 / screen_height) as i32;
            
            // 移动鼠标
            let move_input = INPUT {
                r#type: INPUT_TYPE(0), // INPUT_MOUSE
                Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                    mi: MOUSEINPUT {
                        dx: abs_x,
                        dy: abs_y,
                        mouseData: 0,
                        dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            };
            
            SendInput(&[move_input], std::mem::size_of::<INPUT>() as i32);
            
            // 按下左键
            let down_input = INPUT {
                r#type: INPUT_TYPE(0),
                Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                    mi: MOUSEINPUT {
                        dx: 0,
                        dy: 0,
                        mouseData: 0,
                        dwFlags: MOUSEEVENTF_LEFTDOWN,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            };
            
            SendInput(&[down_input], std::mem::size_of::<INPUT>() as i32);
            
            // 短暂延迟
            std::thread::sleep(std::time::Duration::from_millis(50));
            
            // 释放左键
            let up_input = INPUT {
                r#type: INPUT_TYPE(0),
                Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                    mi: MOUSEINPUT {
                        dx: 0,
                        dy: 0,
                        mouseData: 0,
                        dwFlags: MOUSEEVENTF_LEFTUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            };
            
            SendInput(&[up_input], std::mem::size_of::<INPUT>() as i32);
            
            Ok(())
        }
    }
    
    /// 在元素上输入文本
    pub fn type_text_on_element(&self, element: &IUIAutomationElement, text: &str) -> Result<(), UiaError> {
        unsafe {
            // 先聚焦元素
            self.click_element(element)?;
            
            // 清空现有文本（Ctrl+A + Delete）
            self.send_key_combination(&[VK_CONTROL.0, 0x41]); // Ctrl+A
            self.send_key(VIRTUAL_KEY(0x2E)); // Delete
            
            // 输入文本
            for ch in text.chars() {
                self.send_char(ch)?;
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            
            Ok(())
        }
    }
    
    /// 发送字符
    unsafe fn send_char(&self, ch: char) -> Result<(), UiaError> {
        // 简化的字符发送（仅支持ASCII）
        if ch.is_ascii() {
            let vk = ch.to_ascii_uppercase() as u16;
            let key_input = INPUT {
                r#type: INPUT_TYPE(1), // INPUT_KEYBOARD
                Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(vk),
                        wScan: 0,
                        dwFlags: KEYEVENTF_EXTENDEDKEY(0),
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            };
            
            let key_up = INPUT {
                r#type: INPUT_TYPE(1),
                Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(vk),
                        wScan: 0,
                        dwFlags: KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            };
            
            SendInput(&[key_input], std::mem::size_of::<INPUT>() as i32);
            std::thread::sleep(std::time::Duration::from_millis(20));
            SendInput(&[key_up], std::mem::size_of::<INPUT>() as i32);
        }
        
        Ok(())
    }
    
    /// 发送组合键
    unsafe fn send_key_combination(&self, keys: &[u16]) {
        // 按下所有键
        for &key in keys {
            let input = INPUT {
                r#type: INPUT_TYPE(1),
                Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(key),
                        wScan: 0,
                        dwFlags: KEYEVENTF_EXTENDEDKEY(0),
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            };
            SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        
        // 释放所有键（逆序）
        for &key in keys.iter().rev() {
            let input = INPUT {
                r#type: INPUT_TYPE(1),
                Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(key),
                        wScan: 0,
                        dwFlags: KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            };
            SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }
    
    /// 发送单个按键
    unsafe fn send_key(&self, key: VIRTUAL_KEY) {
        let input = INPUT {
            r#type: INPUT_TYPE(1),
            Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: key,
                    wScan: 0,
                    dwFlags: KEYEVENTF_EXTENDEDKEY(0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        
        SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
        std::thread::sleep(std::time::Duration::from_millis(30));
        
        let up_input = INPUT {
            r#type: INPUT_TYPE(1),
            Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: key,
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        
        SendInput(&[up_input], std::mem::size_of::<INPUT>() as i32);
    }
}

/// 窗口信息
#[derive(Debug, Clone)]
pub struct WindowInfo {
    pub handle: isize,
    pub title: String,
    pub process_id: u32,
    pub rect: Rect,
}

/// 解析矩形变体
unsafe fn parse_rect(variant: &windows::core::VARIANT) -> Result<Rect, UiaError> {
    // UIA 返回的矩形是 [left, top, right, bottom] 数组
    if let Ok(arr) = variant.try_into::<windows::core::Array<f64>>() {
        let data = arr.as_slice();
        if data.len() >= 4 {
            return Ok(Rect {
                x: data[0] as i32,
                y: data[1] as i32,
                width: (data[2] - data[0]) as i32,
                height: (data[3] - data[1]) as i32,
            });
        }
    }
    
    Err(UiaError::ElementNotFound("Invalid rect format".to_string()))
}

/// 控制类型转换
fn control_type_to_uia(ctrl_type: &ControlType) -> i32 {
    match ctrl_type {
        ControlType::Button => UIA_ButtonControlTypeId.0 as i32,
        ControlType::Edit => UIA_EditControlTypeId.0 as i32,
        ControlType::Hyperlink => UIA_HyperlinkControlTypeId.0 as i32,
        ControlType::Image => UIA_ImageControlTypeId.0 as i32,
        ControlType::List => UIA_ListControlTypeId.0 as i32,
        ControlType::ListItem => UIA_ListItemControlTypeId.0 as i32,
        ControlType::Menu => UIA_MenuControlTypeId.0 as i32,
        ControlType::MenuItem => UIA_MenuItemControlTypeId.0 as i32,
        ControlType::Window => UIA_WindowControlTypeId.0 as i32,
        ControlType::Text => UIA_TextControlTypeId.0 as i32,
        ControlType::CheckBox => UIA_CheckBoxControlTypeId.0 as i32,
        ControlType::RadioButton => UIA_RadioButtonControlTypeId.0 as i32,
        ControlType::ComboBox => UIA_ComboBoxControlTypeId.0 as i32,
        ControlType::Tab => UIA_TabControlTypeId.0 as i32,
        ControlType::ScrollBar => UIA_ScrollBarControlTypeId.0 as i32,
        _ => 0,
    }
}

/// UIA 类型转换
fn uia_to_control_type(type_id: i32) -> ControlType {
    match type_id {
        id if id == UIA_ButtonControlTypeId.0 as i32 => ControlType::Button,
        id if id == UIA_EditControlTypeId.0 as i32 => ControlType::Edit,
        id if id == UIA_HyperlinkControlTypeId.0 as i32 => ControlType::Hyperlink,
        id if id == UIA_ImageControlTypeId.0 as i32 => ControlType::Image,
        id if id == UIA_ListControlTypeId.0 as i32 => ControlType::List,
        id if id == UIA_ListItemControlTypeId.0 as i32 => ControlType::ListItem,
        id if id == UIA_MenuControlTypeId.0 as i32 => ControlType::Menu,
        id if id == UIA_MenuItemControlTypeId.0 as i32 => ControlType::MenuItem,
        id if id == UIA_WindowControlTypeId.0 as i32 => ControlType::Window,
        id if id == UIA_TextControlTypeId.0 as i32 => ControlType::Text,
        id if id == UIA_CheckBoxControlTypeId.0 as i32 => ControlType::CheckBox,
        id if id == UIA_RadioButtonControlTypeId.0 as i32 => ControlType::RadioButton,
        id if id == UIA_ComboBoxControlTypeId.0 as i32 => ControlType::ComboBox,
        id if id == UIA_TabControlTypeId.0 as i32 => ControlType::Tab,
        id if id == UIA_ScrollBarControlTypeId.0 as i32 => ControlType::ScrollBar,
        _ => ControlType::Unknown,
    }
}

/// 判断是否可交互
fn is_interactive(ctrl_type: &ControlType) -> bool {
    matches!(ctrl_type,
        ControlType::Button |
        ControlType::Edit |
        ControlType::Hyperlink |
        ControlType::List |
        ControlType::Menu |
        ControlType::MenuItem |
        ControlType::CheckBox |
        ControlType::RadioButton |
        ControlType::ComboBox |
        ControlType::Tab |
        ControlType::ScrollBar
    )
}

/// 枚举窗口回调
unsafe extern "system" fn enum_windows_callback(hwnd: HWND, _lparam: isize) -> i32 {
    // 实际应在全局存储窗口列表
    // 简化实现
    1
}

/// 获取系统度量
unsafe fn GetSystemMetrics(nIndex: i32) -> i32 {
    use windows::Win32::UI::WindowsAndMessaging::GetSystemMetrics;
    GetSystemMetrics(nIndex)
}

const SM_CXSCREEN: i32 = 0;
const SM_CYSCREEN: i32 = 1;
