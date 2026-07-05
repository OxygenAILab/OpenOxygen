//! 运行时模块
//!
//! 核心运行时的子模块实现

use crate::error::CoreError;
use crate::scheduler::Task;

/// 运行时执行器
pub struct RuntimeExecutor;

impl RuntimeExecutor {
    /// 创建新的执行器
    pub fn new() -> Self {
        Self
    }

    /// 执行任务
    pub async fn execute(&self, _task: &Task) -> Result<(), CoreError> {
        Ok(())
    }
}

impl Default for RuntimeExecutor {
    fn default() -> Self {
        Self::new()
    }
}
