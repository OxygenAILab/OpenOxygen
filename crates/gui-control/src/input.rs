//! 输入模拟模块
//!
//! 模拟鼠标和键盘输入
//! 当前为 stub 实现，仅验证调用链路

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
    pub async fn move_to(&self, _x: i32, _y: i32) -> Result<(), crate::GuiError> {
        // stub: 不实际移动
        Ok(())
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
        _button: MouseButton,
    ) -> Result<(), crate::GuiError> {
        self.move_to(x, y).await?;
        // stub: 不实际点击
        Ok(())
    }

    /// 输入文本
    pub async fn type_text(&self, _text: &str) -> Result<(), crate::GuiError> {
        // stub: 不实际输入
        Ok(())
    }

    /// 按下按键
    pub async fn key_press(&self, _key: char) -> Result<(), crate::GuiError> {
        // stub: 不实际按键
        Ok(())
    }

    /// 组合键
    pub async fn key_combo(
        &self,
        _modifiers: &[ModifierKey],
        _key: char,
    ) -> Result<(), crate::GuiError> {
        // stub: 不实际按键
        Ok(())
    }

    /// 滚动
    pub async fn scroll(&self, x: i32, y: i32, _delta: i32) -> Result<(), crate::GuiError> {
        self.move_to(x, y).await?;
        // stub: 不实际滚动
        Ok(())
    }

    /// 拖拽
    pub async fn drag(
        &self,
        from: (i32, i32),
        to: (i32, i32),
    ) -> Result<(), crate::GuiError> {
        self.move_to(from.0, from.1).await?;
        // stub: 简化实现，只移动到终点
        self.move_to(to.0, to.1).await?;
        Ok(())
    }
}

impl Default for InputSimulator {
    fn default() -> Self {
        Self::new().expect("Failed to create input simulator")
    }
}
