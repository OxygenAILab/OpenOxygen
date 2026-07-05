//! Windows UIA (UI Automation) 集成
//!
//! 基于 Microsoft UI Automation API
//! 当前为 stub 实现，真实功能将在后续版本中完善

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// UIA 自动化控制器
pub struct UiaAutomation;

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
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
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
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

/// 查找条件
#[derive(Debug, Clone, Default)]
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
    WindowsError(String),

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

    #[error("Not implemented")]
    NotImplemented,
}

impl UiaAutomation {
    /// 初始化 UIA 自动化
    pub fn new() -> Result<Self, UiaError> {
        // stub: 未实现真实 UIA 连接
        Ok(Self)
    }

    /// 获取桌面元素
    pub fn get_desktop(&self) -> Result<(), UiaError> {
        Err(UiaError::NotImplemented)
    }

    /// 获取活动窗口元素
    pub fn get_active_window_element(&self) -> Result<(), UiaError> {
        Err(UiaError::NotImplemented)
    }

    /// 查找元素
    pub fn find_element(&self, _condition: &FindCondition) -> Result<(), UiaError> {
        Err(UiaError::NotImplemented)
    }

    /// 查找多个元素
    pub fn find_elements(
        &self,
        _condition: &FindCondition,
        _max_results: i32,
    ) -> Result<Vec<ElementInfo>, UiaError> {
        Ok(vec![])
    }

    /// 获取元素信息
    pub fn get_element_info(&self, _element: &()) -> Result<ElementInfo, UiaError> {
        Err(UiaError::NotImplemented)
    }

    /// 获取元素在坐标处的元素
    pub fn get_element_at(&self, _x: i32, _y: i32) -> Result<(), UiaError> {
        Err(UiaError::NotImplemented)
    }

    /// 获取所有可交互元素
    pub fn get_interactive_elements(&self) -> Result<Vec<ElementInfo>, UiaError> {
        Ok(vec![])
    }

    /// 获取窗口列表
    pub fn get_windows(&self) -> Result<Vec<WindowInfo>, UiaError> {
        Ok(vec![])
    }

    /// 点击元素
    pub fn click_element(&self, _element: &()) -> Result<(), UiaError> {
        Err(UiaError::NotImplemented)
    }

    /// 在坐标处点击
    pub fn click_at(&self, _x: i32, _y: i32) -> Result<(), UiaError> {
        Err(UiaError::NotImplemented)
    }

    /// 在元素上输入文本
    pub fn type_text_on_element(&self, _element: &(), _text: &str) -> Result<(), UiaError> {
        Err(UiaError::NotImplemented)
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

impl Default for WindowInfo {
    fn default() -> Self {
        Self {
            handle: 0,
            title: String::new(),
            process_id: 0,
            rect: Rect::default(),
        }
    }
}

/// 判断是否可交互
pub fn is_interactive(ctrl_type: &ControlType) -> bool {
    matches!(
        ctrl_type,
        ControlType::Button
            | ControlType::Edit
            | ControlType::Hyperlink
            | ControlType::List
            | ControlType::Menu
            | ControlType::MenuItem
            | ControlType::CheckBox
            | ControlType::RadioButton
            | ControlType::ComboBox
            | ControlType::Tab
            | ControlType::ScrollBar
    )
}
