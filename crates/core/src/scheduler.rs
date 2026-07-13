//! 任务调度器
//!
//! 负责任务的队列管理、优先级调度和执行协调

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};

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
    CliCommand {
        command: String,
        cwd: Option<String>,
    },
    #[serde(rename = "browser_action")]
    BrowserAction { action: BrowserAction },
    #[serde(rename = "llm_inference")]
    LlmInference {
        prompt: String,
        model: Option<String>,
    },
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
    Running {
        step: usize,
        started_at: chrono::DateTime<chrono::Utc>,
    },
    Paused,
    Completed {
        completed_at: chrono::DateTime<chrono::Utc>,
        output: serde_json::Value,
    },
    Failed {
        error: String,
        failed_at: chrono::DateTime<chrono::Utc>,
    },
    Cancelled,
}

/// 步骤事件 (用于追踪执行过程)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepEvent {
    pub task_id: String,
    pub step_id: String,
    pub event_type: StepEventType,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

/// 步骤事件类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum StepEventType {
    #[serde(rename = "step_started")]
    StepStarted,
    #[serde(rename = "step_completed")]
    StepCompleted {
        output: serde_json::Value,
        duration_ms: u64,
    },
    #[serde(rename = "step_failed")]
    StepFailed {
        error: String,
        duration_ms: u64,
    },
}

/// 任务追踪记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskTrace {
    pub task_id: String,
    pub events: Vec<StepEvent>,
}

impl TaskTrace {
    pub fn new(task_id: String) -> Self {
        Self {
            task_id,
            events: Vec::new(),
        }
    }

    pub fn push(&mut self, event: StepEvent) {
        self.events.push(event);
    }
}

/// 任务调度器
pub struct TaskScheduler {
    /// 任务队列
    queue: VecDeque<Task>,
    /// 任务状态映射
    status_map: HashMap<String, TaskStatus>,
    /// 任务追踪记录
    traces: HashMap<String, TaskTrace>,
    /// 是否运行中
    running: bool,
}

impl TaskScheduler {
    pub fn new() -> Self {
        Self {
            queue: VecDeque::new(),
            status_map: HashMap::new(),
            traces: HashMap::new(),
            running: false,
        }
    }

    /// 提交任务
    pub async fn submit(&mut self, task: Task) -> Result<(), CoreError> {
        if self.status_map.contains_key(&task.id) {
            return Err(CoreError::TaskAlreadyExists(task.id));
        }

        self.status_map.insert(task.id.clone(), TaskStatus::Queued);

        // 根据优先级插入队列
        let pos = self
            .queue
            .iter()
            .position(|t| t.priority > task.priority)
            .unwrap_or(self.queue.len());
        self.queue.insert(pos, task);

        Ok(())
    }

    /// 启动调度器状态
    pub fn start(&mut self) {
        self.running = true;
    }

    /// 停止调度器状态
    pub fn stop(&mut self) {
        self.running = false;
    }

    /// 取出下一个待执行任务
    pub fn next_task(&mut self) -> Option<Task> {
        if !self.running {
            return None;
        }

        let task = self.queue.pop_front()?;
        self.status_map.insert(
            task.id.clone(),
            TaskStatus::Running {
                step: 0,
                started_at: chrono::Utc::now(),
            },
        );
        Some(task)
    }

    /// 标记任务完成
    pub fn complete(&mut self, task_id: &str, output: serde_json::Value) {
        self.status_map.insert(
            task_id.to_string(),
            TaskStatus::Completed {
                completed_at: chrono::Utc::now(),
                output,
            },
        );
    }

    /// 标记任务失败
    pub fn fail(&mut self, task_id: &str, error: impl Into<String>) {
        self.status_map.insert(
            task_id.to_string(),
            TaskStatus::Failed {
                error: error.into(),
                failed_at: chrono::Utc::now(),
            },
        );
    }

    /// 获取任务状态
    pub async fn get_status(&self, task_id: &str) -> Option<TaskStatus> {
        self.status_map.get(task_id).cloned()
    }

    /// 获取任务输出
    pub fn get_output(&self, task_id: &str) -> Option<serde_json::Value> {
        match self.status_map.get(task_id) {
            Some(TaskStatus::Completed { output, .. }) => Some(output.clone()),
            _ => None,
        }
    }

    /// 取消任务
    pub async fn cancel(&mut self, task_id: &str) -> Result<(), CoreError> {
        if let Some(status) = self.status_map.get_mut(task_id) {
            *status = TaskStatus::Cancelled;
            self.queue.retain(|task| task.id != task_id);
            Ok(())
        } else {
            Err(CoreError::TaskNotFound(task_id.to_string()))
        }
    }

    /// 记录步骤事件到追踪
    pub fn record_step_event(&mut self, event: StepEvent) {
        let trace = self
            .traces
            .entry(event.task_id.clone())
            .or_insert_with(|| TaskTrace::new(event.task_id.clone()));
        trace.push(event);
    }

    /// 获取任务追踪记录
    pub fn get_task_trace(&self, task_id: &str) -> Option<TaskTrace> {
        self.traces.get(task_id).cloned()
    }
}

impl Default for TaskScheduler {
    fn default() -> Self {
        Self::new()
    }
}
