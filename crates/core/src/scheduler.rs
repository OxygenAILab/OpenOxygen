//! 任务调度器
//! 
//! 负责任务的队列管理、优先级调度和执行协调

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use serde::{Deserialize, Serialize};

use crate::error::CoreError;

/// 任务定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub name: String,
    pub description: String,
    pub priority: TaskPriority,
    pub steps: Vec<TaskStep>,
    pub metadata: HashMap<String, serde_json::Value>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// 任务优先级
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum TaskPriority {
    Critical = 0,
    High = 1,
    Normal = 2,
    Low = 3,
}

/// 任务步骤
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStep {
    pub id: String,
    pub step_type: StepType,
    pub params: serde_json::Value,
    pub depends_on: Vec<String>,
}

/// 步骤类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum StepType {
    #[serde(rename = "gui_action")]
    GuiAction { action: GuiAction },
    #[serde(rename = "cli_command")]
    CliCommand { command: String, cwd: Option<String> },
    #[serde(rename = "browser_action")]
    BrowserAction { action: BrowserAction },
    #[serde(rename = "llm_inference")]
    LlmInference { prompt: String, model: Option<String> },
    #[serde(rename = "wait")]
    Wait { duration_ms: u64 },
    #[serde(rename = "condition")]
    Condition { check: String },
}

/// GUI 动作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuiAction {
    pub action_type: String, // click, type, scroll, etc.
    pub target: GuiTarget,
    pub params: serde_json::Value,
}

/// GUI 目标
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "target_type")]
pub enum GuiTarget {
    #[serde(rename = "coordinates")]
    Coordinates { x: i32, y: i32 },
    #[serde(rename = "element_id")]
    ElementId { id: String },
    #[serde(rename = "description")]
    Description { desc: String },
    #[serde(rename = "image_match")]
    ImageMatch { template: String, confidence: f32 },
}

/// 浏览器动作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserAction {
    pub action_type: String,
    pub params: serde_json::Value,
}

/// 任务状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TaskStatus {
    Pending,
    Queued,
    Running { step: usize, started_at: chrono::DateTime<chrono::Utc> },
    Paused,
    Completed { completed_at: chrono::DateTime<chrono::Utc> },
    Failed { error: String, failed_at: chrono::DateTime<chrono::Utc> },
    Cancelled,
}

/// 任务调度器
pub struct TaskScheduler {
    /// 任务队列
    queue: VecDeque<Task>,
    /// 任务状态映射
    status_map: HashMap<String, TaskStatus>,
    /// 执行通道发送端
    exec_tx: Option<mpsc::Sender<Task>>,
    /// 是否运行中
    running: bool,
}

impl TaskScheduler {
    pub fn new() -> Self {
        Self {
            queue: VecDeque::new(),
            status_map: HashMap::new(),
            exec_tx: None,
            running: false,
        }
    }

    /// 提交任务
    pub async fn submit(&mut self, task: Task) -> Result<(), CoreError> {
        self.status_map.insert(task.id.clone(), TaskStatus::Queued);
        
        // 根据优先级插入队列
        let pos = self.queue.iter()
            .position(|t| t.priority > task.priority)
            .unwrap_or(self.queue.len());
        self.queue.insert(pos, task);
        
        Ok(())
    }

    /// 启动调度器
    pub async fn start(&mut self) {
        self.running = true;
        
        // 调度循环
        while self.running {
            if let Some(task) = self.queue.pop_front() {
                self.status_map.insert(
                    task.id.clone(), 
                    TaskStatus::Running { 
                        step: 0, 
                        started_at: chrono::Utc::now() 
                    }
                );
                
                // TODO: 发送给执行器
            }
            
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
    }

    /// 获取任务状态
    pub async fn get_status(&self, task_id: &str) -> Option<TaskStatus> {
        self.status_map.get(task_id).cloned()
    }

    /// 取消任务
    pub async fn cancel(&mut self, task_id: &str) -> Result<(), CoreError> {
        if let Some(status) = self.status_map.get_mut(task_id) {
            *status = TaskStatus::Cancelled;
        }
        Ok(())
    }
}

impl Default for TaskScheduler {
    fn default() -> Self {
        Self::new()
    }
}
