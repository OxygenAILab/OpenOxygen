//! HTN 原子操作执行引擎
//! 
//! 将规划好的任务转换为实际的 GUI/CLI/浏览器操作

use std::sync::Arc;
use std::collections::HashMap;
use tokio::sync::{mpsc, RwLock};
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

use crate::{Task, TaskType, PrimitiveTask, Action, TaskStatus, TaskResult, TaskMetrics, ResourceUsage};

/// 执行引擎
pub struct ExecutionEngine {
    /// GUI 控制器
    gui_controller: Option<Arc<dyn GuiController>>,
    /// CLI 执行器
    cli_executor: Option<Arc<dyn CliExecutor>>,
    /// 浏览器控制器
    browser_controller: Option<Arc<dyn BrowserController>>,
    /// 技能注册表
    skill_registry: Arc<dyn SkillRegistry>,
    /// 执行配置
    config: ExecutionConfig,
    /// 任务结果通道
    result_tx: mpsc::Sender<TaskResult>,
}

/// 执行配置
#[derive(Debug, Clone)]
pub struct ExecutionConfig {
    /// 默认超时 (ms)
    pub default_timeout_ms: u64,
    /// 截图间隔 (ms)
    pub screenshot_interval_ms: u64,
    /// 重试间隔 (ms)
    pub retry_interval_ms: u64,
    /// 最大并发
    pub max_concurrency: usize,
    /// 启用实时监控
    pub enable_monitoring: bool,
}

impl Default for ExecutionConfig {
    fn default() -> Self {
        Self {
            default_timeout_ms: 30000,
            screenshot_interval_ms: 500,
            retry_interval_ms: 1000,
            max_concurrency: 4,
            enable_monitoring: true,
        }
    }
}

/// GUI 控制器 trait
#[async_trait::async_trait]
pub trait GuiController: Send + Sync {
    async fn click(&self, x: i32, y: i32) -> Result<GuiResult, ExecutionError>;
    async fn double_click(&self, x: i32, y: i32) -> Result<GuiResult, ExecutionError>;
    async fn right_click(&self, x: i32, y: i32) -> Result<GuiResult, ExecutionError>;
    async fn type_text(&self, text: &str) -> Result<GuiResult, ExecutionError>;
    async fn key_press(&self, key: &str) -> Result<GuiResult, ExecutionError>;
    async fn scroll(&self, delta: i32) -> Result<GuiResult, ExecutionError>;
    async fn drag(&self, from: (i32, i32), to: (i32, i32)) -> Result<GuiResult, ExecutionError>;
    async fn screenshot(&self) -> Result<String, ExecutionError>; // base64
    async fn get_element_at(&self, x: i32, y: i32) -> Result<ElementInfo, ExecutionError>;
    async fn find_element(&self, description: &str) -> Result<ElementInfo, ExecutionError>;
    async fn wait_for_element(&self, description: &str, timeout_ms: u64) -> Result<ElementInfo, ExecutionError>;
}

/// CLI 执行器 trait
#[async_trait::async_trait]
pub trait CliExecutor: Send + Sync {
    async fn execute(&self, command: &str, options: &CliOptions) -> Result<CliResult, ExecutionError>;
    async fn spawn(&self, command: &str, options: &CliOptions) -> Result<ProcessHandle, ExecutionError>;
    async fn kill(&self, handle: &ProcessHandle) -> Result<(), ExecutionError>;
    async fn get_output(&self, handle: &ProcessHandle) -> Result<String, ExecutionError>;
}

/// 浏览器控制器 trait
#[async_trait::async_trait]
pub trait BrowserController: Send + Sync {
    async fn navigate(&self, url: &str) -> Result<BrowserResult, ExecutionError>;
    async fn click(&self, selector: &str) -> Result<BrowserResult, ExecutionError>;
    async fn type_text(&self, selector: &str, text: &str) -> Result<BrowserResult, ExecutionError>;
    async fn screenshot(&self) -> Result<String, ExecutionError>;
    async fn get_page_source(&self) -> Result<String, ExecutionError>;
    async fn evaluate(&self, script: &str) -> Result<serde_json::Value, ExecutionError>;
}

/// 技能注册表 trait
#[async_trait::async_trait]
pub trait SkillRegistry: Send + Sync {
    async fn execute(&self, skill_name: &str, params: &serde_json::Value) -> Result<SkillResult, ExecutionError>;
    async fn get_skill(&self, name: &str) -> Option<SkillInfo>;
}

/// 执行请求
#[derive(Debug, Clone)]
pub struct ExecuteRequest {
    /// 任务
    pub task: Task,
    /// 上下文
    pub context: ExecutionContext,
    /// 执行 ID
    pub execution_id: String,
}

/// 执行上下文
#[derive(Debug, Clone)]
pub struct ExecutionContext {
    /// 会话 ID
    pub session_id: String,
    /// 父任务 ID
    pub parent_task_id: Option<String>,
    /// 前置结果
    pub previous_results: Vec<TaskResult>,
    /// 环境变量
    pub environment: HashMap<String, String>,
    /// 工作目录
    pub working_directory: String,
    /// 元数据
    pub metadata: HashMap<String, serde_json::Value>,
}

/// GUI 操作结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuiResult {
    pub success: bool,
    pub screenshot_before: Option<String>,
    pub screenshot_after: Option<String>,
    pub element_info: Option<ElementInfo>,
    pub action_description: String,
    pub execution_time_ms: u64,
    pub error: Option<String>,
}

/// CLI 操作结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliResult {
    pub success: bool,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub parsed_output: Option<serde_json::Value>,
    pub execution_time_ms: u64,
}

/// CLI 选项
#[derive(Debug, Clone, Default)]
pub struct CliOptions {
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub timeout_ms: Option<u64>,
    pub capture_output: bool,
    pub shell: Option<String>,
}

/// 浏览器操作结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserResult {
    pub success: bool,
    pub url: String,
    pub title: String,
    pub screenshot: Option<String>,
    pub execution_time_ms: u64,
}

/// 技能执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillResult {
    pub success: bool,
    pub output: serde_json::Value,
    pub logs: Vec<String>,
    pub metrics: Option<HashMap<String, f64>>,
}

/// 元素信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ElementInfo {
    pub id: Option<String>,
    pub name: String,
    pub control_type: String,
    pub bounds: (i32, i32, i32, i32),
    pub center: (i32, i32),
    pub value: Option<String>,
    pub is_enabled: bool,
    pub is_visible: bool,
}

/// 进程句柄
#[derive(Debug, Clone)]
pub struct ProcessHandle {
    pub pid: u32,
    pub command: String,
    pub started_at: DateTime<Utc>,
}

/// 技能信息
#[derive(Debug, Clone)]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub parameters: Vec<ParameterSpec>,
    pub return_type: String,
}

/// 参数规格
#[derive(Debug, Clone)]
pub struct ParameterSpec {
    pub name: String,
    pub param_type: String,
    pub required: bool,
    pub default: Option<serde_json::Value>,
}

/// 执行错误
#[derive(Debug, thiserror::Error)]
pub enum ExecutionError {
    #[error("GUI controller error: {0}")]
    GuiError(String),
    
    #[error("CLI executor error: {0}")]
    CliError(String),
    
    #[error("Browser controller error: {0}")]
    BrowserError(String),
    
    #[error("Skill error: {0}")]
    SkillError(String),
    
    #[error("Timeout: {0}")]
    Timeout(String),
    
    #[error("Task cancelled")]
    Cancelled,
    
    #[error("Invalid action: {0}")]
    InvalidAction(String),
    
    #[error("Element not found: {0}")]
    ElementNotFound(String),
    
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}

impl ExecutionEngine {
    /// 创建新的执行引擎
    pub fn new(
        gui: Option<Arc<dyn GuiController>>,
        cli: Option<Arc<dyn CliExecutor>>,
        browser: Option<Arc<dyn BrowserController>>,
        skills: Arc<dyn SkillRegistry>,
        config: ExecutionConfig,
    ) -> Self {
        let (result_tx, _result_rx) = mpsc::channel(100);
        
        Self {
            gui_controller: gui,
            cli_executor: cli,
            browser_controller: browser,
            skill_registry: skills,
            config,
            result_tx,
        }
    }

    /// 执行单个任务
    pub async fn execute(&self, request: ExecuteRequest) -> Result<TaskResult, ExecutionError> {
        let start = std::time::Instant::now();
        let execution_id = request.execution_id;
        
        log::info!("Executing task: {} ({})", request.task.name, execution_id);
        
        let result = match &request.task.task_type {
            TaskType::Primitive(primitive) => {
                self.execute_primitive(primitive, &request.context).await
            }
            TaskType::Compound(_) => {
                // 复合任务不应直接执行，需要分解
                Err(ExecutionError::InvalidAction(
                    "Compound tasks must be decomposed before execution".to_string()
                ))
            }
            TaskType::Goal(_) => {
                Err(ExecutionError::InvalidAction(
                    "Goal tasks must be converted to primitive tasks".to_string()
                ))
            }
        };
        
        let duration = start.elapsed().as_millis() as u64;
        
        match result {
            Ok(output) => {
                Ok(TaskResult {
                    task_id: request.task.id.clone(),
                    agent_id: "executor".to_string(),
                    success: true,
                    output,
                    completed_at: Utc::now(),
                    metrics: TaskMetrics {
                        execution_time_ms: duration,
                        resource_usage: ResourceUsage {
                            cpu_percent: 0.0,
                            memory_mb: 0,
                            network_bytes: 0,
                        },
                    },
                })
            }
            Err(e) => {
                Ok(TaskResult {
                    task_id: request.task.id.clone(),
                    agent_id: "executor".to_string(),
                    success: false,
                    output: serde_json::json!({"error": e.to_string()}),
                    completed_at: Utc::now(),
                    metrics: TaskMetrics {
                        execution_time_ms: duration,
                        resource_usage: ResourceUsage::default(),
                    },
                })
            }
        }
    }

    /// 执行原始任务
    async fn execute_primitive(
        &self,
        primitive: &PrimitiveTask,
        context: &ExecutionContext,
    ) -> Result<serde_json::Value, ExecutionError> {
        match primitive.action.action_type.as_str() {
            "gui_click" => self.execute_gui_click(&primitive.action).await,
            "gui_type" => self.execute_gui_type(&primitive.action).await,
            "gui_screenshot" => self.execute_gui_screenshot().await,
            "gui_find_element" => self.execute_gui_find_element(&primitive.action).await,
            "cli_execute" => self.execute_cli(&primitive.action, context).await,
            "browser_navigate" => self.execute_browser_navigate(&primitive.action).await,
            "browser_click" => self.execute_browser_click(&primitive.action).await,
            "skill_invoke" => self.execute_skill(&primitive.action).await,
            "wait" => self.execute_wait(&primitive.action).await,
            "screenshot" => self.execute_screenshot().await,
            _ => Err(ExecutionError::InvalidAction(
                format!("Unknown action type: {}", primitive.action.action_type)
            )),
        }
    }

    /// 执行 GUI 点击
    async fn execute_gui_click(&self, action: &Action) -> Result<serde_json::Value, ExecutionError> {
        let gui = self.gui_controller.as_ref()
            .ok_or_else(|| ExecutionError::GuiError("GUI controller not available".to_string()))?;
        
        // 获取坐标
        let x = action.params.get("x")
            .and_then(|v| v.as_i64())
            .ok_or_else(|| ExecutionError::InvalidAction("Missing x coordinate".to_string()))? as i32;
        
        let y = action.params.get("y")
            .and_then(|v| v.as_i64())
            .ok_or_else(|| ExecutionError::InvalidAction("Missing y coordinate".to_string()))? as i32;
        
        // 截图（操作前）
        let screenshot_before = gui.screenshot().await.ok();
        
        // 执行点击
        let result = gui.click(x, y).await?;
        
        // 短暂延迟
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        
        // 截图（操作后）
        let screenshot_after = gui.screenshot().await.ok();
        
        Ok(serde_json::json!({
            "action": "click",
            "coordinates": [x, y],
            "success": result.success,
            "screenshot_before": screenshot_before,
            "screenshot_after": screenshot_after,
        }))
    }

    /// 执行 GUI 输入
    async fn execute_gui_type(&self, action: &Action) -> Result<serde_json::Value, ExecutionError> {
        let gui = self.gui_controller.as_ref()
            .ok_or_else(|| ExecutionError::GuiError("GUI controller not available".to_string()))?;
        
        let text = action.params.get("text")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ExecutionError::InvalidAction("Missing text".to_string()))?;
        
        // 如果指定了目标元素，先点击
        if let Some(target) = action.params.get("target").and_then(|v| v.as_str()) {
            let element = gui.find_element(target).await?;
            gui.click(element.center.0, element.center.1).await?;
        }
        
        // 输入文本
        gui.type_text(text).await?;
        
        Ok(serde_json::json!({
            "action": "type",
            "text": text,
            "success": true,
        }))
    }

    /// 执行 GUI 截图
    async fn execute_gui_screenshot(&self) -> Result<serde_json::Value, ExecutionError> {
        let gui = self.gui_controller.as_ref()
            .ok_or_else(|| ExecutionError::GuiError("GUI controller not available".to_string()))?;
        
        let screenshot = gui.screenshot().await?;
        
        Ok(serde_json::json!({
            "action": "screenshot",
            "screenshot": screenshot,
        }))
    }

    /// 执行 GUI 查找元素
    async fn execute_gui_find_element(&self, action: &Action) -> Result<serde_json::Value, ExecutionError> {
        let gui = self.gui_controller.as_ref()
            .ok_or_else(|| ExecutionError::GuiError("GUI controller not available".to_string()))?;
        
        let description = action.params.get("description")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ExecutionError::InvalidAction("Missing description".to_string()))?;
        
        let element = gui.find_element(description).await?;
        
        Ok(serde_json::json!({
            "action": "find_element",
            "element": {
                "id": element.id,
                "name": element.name,
                "control_type": element.control_type,
                "bounds": element.bounds,
                "center": element.center,
                "value": element.value,
                "is_enabled": element.is_enabled,
                "is_visible": element.is_visible,
            },
        }))
    }

    /// 执行 CLI 命令
    async fn execute_cli(
        &self,
        action: &Action,
        context: &ExecutionContext,
    ) -> Result<serde_json::Value, ExecutionError> {
        let cli = self.cli_executor.as_ref()
            .ok_or_else(|| ExecutionError::CliError("CLI executor not available".to_string()))?;
        
        let command = action.params.get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ExecutionError::InvalidAction("Missing command".to_string()))?;
        
        let options = CliOptions {
            cwd: action.params.get("cwd").and_then(|v| v.as_str()).map(|s| s.to_string()),
            env: context.environment.clone().into(),
            timeout_ms: action.params.get("timeout").and_then(|v| v.as_u64()).map(|u| u as u64),
            capture_output: true,
            shell: action.params.get("shell").and_then(|v| v.as_str()).map(|s| s.to_string()),
        };
        
        let result = cli.execute(command, &options).await?;
        
        Ok(serde_json::json!({
            "action": "cli_execute",
            "command": command,
            "exit_code": result.exit_code,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "success": result.success && result.exit_code == 0,
            "duration_ms": result.execution_time_ms,
        }))
    }

    /// 执行浏览器导航
    async fn execute_browser_navigate(&self, action: &Action) -> Result<serde_json::Value, ExecutionError> {
        let browser = self.browser_controller.as_ref()
            .ok_or_else(|| ExecutionError::BrowserError("Browser controller not available".to_string()))?;
        
        let url = action.params.get("url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ExecutionError::InvalidAction("Missing URL".to_string()))?;
        
        let result = browser.navigate(url).await?;
        
        Ok(serde_json::json!({
            "action": "browser_navigate",
            "url": result.url,
            "title": result.title,
            "success": result.success,
        }))
    }

    /// 执行浏览器点击
    async fn execute_browser_click(&self, action: &Action) -> Result<serde_json::Value, ExecutionError> {
        let browser = self.browser_controller.as_ref()
            .ok_or_else(|| ExecutionError::BrowserError("Browser controller not available".to_string()))?;
        
        let selector = action.params.get("selector")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ExecutionError::InvalidAction("Missing selector".to_string()))?;
        
        let result = browser.click(selector).await?;
        
        Ok(serde_json::json!({
            "action": "browser_click",
            "selector": selector,
            "success": result.success,
        }))
    }

    /// 执行技能
    async fn execute_skill(&self, action: &Action) -> Result<serde_json::Value, ExecutionError> {
        let skill_name = action.params.get("skill")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ExecutionError::InvalidAction("Missing skill name".to_string()))?;
        
        let params = action.params.get("params")
            .cloned()
            .unwrap_or(serde_json::json!({}));
        
        let result = self.skill_registry.execute(skill_name, &params).await?;
        
        Ok(serde_json::json!({
            "action": "skill_invoke",
            "skill": skill_name,
            "success": result.success,
            "output": result.output,
        }))
    }

    /// 执行等待
    async fn execute_wait(&self, action: &Action) -> Result<serde_json::Value, ExecutionError> {
        let duration_ms = action.params.get("duration_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(1000);
        
        tokio::time::sleep(tokio::time::Duration::from_millis(duration_ms)).await;
        
        Ok(serde_json::json!({
            "action": "wait",
            "duration_ms": duration_ms,
        }))
    }

    /// 执行截图（通用）
    async fn execute_screenshot(&self) -> Result<serde_json::Value, ExecutionError> {
        // 优先使用 GUI 控制器
        if let Some(gui) = &self.gui_controller {
            match gui.screenshot().await {
                Ok(screenshot) => {
                    return Ok(serde_json::json!({
                        "action": "screenshot",
                        "source": "gui",
                        "screenshot": screenshot,
                    }));
                }
                Err(_) => {}
            }
        }
        
        // 否则使用浏览器
        if let Some(browser) = &self.browser_controller {
            match browser.screenshot().await {
                Ok(screenshot) => {
                    return Ok(serde_json::json!({
                        "action": "screenshot",
                        "source": "browser",
                        "screenshot": screenshot,
                    }));
                }
                Err(_) => {}
            }
        }
        
        Err(ExecutionError::GuiError("No screenshot capability available".to_string()))
    }

    /// 批量执行任务
    pub async fn execute_batch(
        &self,
        requests: Vec<ExecuteRequest>,
    ) -> Vec<Result<TaskResult, ExecutionError>> {
        let mut results = Vec::new();
        
        for request in requests {
            let result = self.execute(request).await;
            results.push(result);
        }
        
        results
    }

    /// 带重试的执行
    pub async fn execute_with_retry(
        &self,
        request: ExecuteRequest,
        max_retries: u32,
    ) -> Result<TaskResult, ExecutionError> {
        let mut last_error = None;
        
        for attempt in 0..=max_retries {
            if attempt > 0 {
                log::warn!("Retrying task {} (attempt {})", request.task.id, attempt);
                tokio::time::sleep(tokio::time::Duration::from_millis(self.config.retry_interval_ms)).await;
            }
            
            match self.execute(request.clone()).await {
                Ok(result) if result.success => return Ok(result),
                Ok(result) => {
                    last_error = Some(ExecutionError::InvalidAction(
                        result.output.to_string()
                    ));
                }
                Err(e) => {
                    last_error = Some(e);
                }
            }
        }
        
        Err(last_error.unwrap_or_else(|| ExecutionError::InvalidAction("Max retries exceeded".to_string())))
    }
}

use std::default::Default;

impl Default for ResourceUsage {
    fn default() -> Self {
        Self {
            cpu_percent: 0.0,
            memory_mb: 0,
            network_bytes: 0,
        }
    }
}
