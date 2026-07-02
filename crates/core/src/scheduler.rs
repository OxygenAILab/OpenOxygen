//! Task Scheduler
//! 
//! Responsible for task queue management, priority scheduling, and execution coordination
//! GitHub@StarsailsClover

use std::collections::{HashMap, VecDeque};
use tokio::sync::mpsc;
use serde::{Deserialize, Serialize};
use chrono;

use crate::error::CoreError;

/// Task definition
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

/// Task priority
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum TaskPriority {
    Critical = 0,
    High = 1,
    Normal = 2,
    Low = 3,
}

/// Task step
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStep {
    pub id: String,
    pub step_type: StepType,
    pub params: serde_json::Value,
    pub depends_on: Vec<String>,
}

/// Step type
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

/// GUI action
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuiAction {
    pub action_type: String,
    pub target: GuiTarget,
    pub params: serde_json::Value,
}

/// GUI target
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

/// Browser action
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserAction {
    pub action_type: String,
    pub params: serde_json::Value,
}

/// Task status
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

/// Task scheduler
pub struct TaskScheduler {
    /// Task queue
    queue: VecDeque<Task>,
    /// Task status mapping
    status_map: HashMap<String, TaskStatus>,
    /// Execution channel sender
    exec_tx: Option<mpsc::Sender<Task>>,
    /// Is running flag
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

    /// Submit task
    pub async fn submit(&mut self, task: Task) -> Result<(), CoreError> {
        self.status_map.insert(task.id.clone(), TaskStatus::Queued);
        
        let pos = self.queue.iter()
            .position(|t| t.priority > task.priority)
            .unwrap_or(self.queue.len());
        self.queue.insert(pos, task);
        
        Ok(())
    }

    /// Start scheduler
    pub async fn start(&mut self) {
        self.running = true;
        
        while self.running {
            if let Some(task) = self.queue.pop_front() {
                self.status_map.insert(
                    task.id.clone(), 
                    TaskStatus::Running { 
                        step: 0, 
                        started_at: chrono::Utc::now() 
                    }
                );
                
                // TODO: Send to executor
            }
            
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
    }

    /// Get task status
    pub async fn get_status(&self, task_id: &str) -> Option<TaskStatus> {
        self.status_map.get(task_id).cloned()
    }

    /// Cancel task
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
