//! CLI 执行器
//! 
//! 执行命令行命令，捕获输出，管理长时间运行的进程

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

pub mod shell;
pub mod parser;

/// CLI 执行器
pub struct CliExecutor {
    /// 活跃进程映射
    processes: Arc<RwLock<HashMap<String, RunningProcess>>>,
    /// 默认 shell
    default_shell: String,
    /// 工作目录
    working_dir: Arc<RwLock<std::path::PathBuf>>,
}

/// 执行请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionRequest {
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub capture_output: bool,
    #[serde(default)]
    pub stream_output: bool,
}

/// 执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionResult {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub stdout_lines: Vec<String>,
    pub stderr_lines: Vec<String>,
    pub duration_ms: u64,
    pub command: String,
    pub started_at: DateTime<Utc>,
    pub completed_at: DateTime<Utc>,
}

/// 流式输出
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamOutput {
    pub process_id: String,
    pub output_type: OutputType,
    pub content: String,
    pub timestamp: DateTime<Utc>,
}

/// 输出类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputType {
    Stdout,
    Stderr,
    Info,
    Error,
    Exit,
}

/// 运行中的进程
#[derive(Debug)]
struct RunningProcess {
    id: String,
    child: Child,
    command: String,
    started_at: DateTime<Utc>,
    stdout_buffer: Vec<String>,
    stderr_buffer: Vec<String>,
}

impl CliExecutor {
    /// 创建新的 CLI 执行器
    pub fn new() -> Result<Self, CliError> {
        let working_dir = std::env::current_dir()
            .map_err(|e| CliError::IoError(e.to_string()))?;
        
        Ok(Self {
            processes: Arc::new(RwLock::new(HashMap::new())),
            default_shell: Self::detect_shell(),
            working_dir: Arc::new(RwLock::new(working_dir)),
        })
    }

    /// 检测系统默认 shell
    fn detect_shell() -> String {
        #[cfg(target_os = "windows")]
        {
            "powershell.exe".to_string()
        }
        
        #[cfg(not(target_os = "windows"))]
        {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
        }
    }

    /// 执行命令
    pub async fn execute(&self, request: ExecutionRequest) -> Result<ExecutionResult, CliError> {
        let start = std::time::Instant::now();
        let started_at = Utc::now();

        // 解析工作目录
        let cwd = if let Some(cwd) = &request.cwd {
            std::path::PathBuf::from(cwd)
        } else {
            self.working_dir.read().await.clone()
        };

        // 构建命令
        let mut cmd = if cfg!(target_os = "windows") {
            let mut cmd = Command::new("cmd");
            cmd.arg("/C").arg(&request.command);
            cmd
        } else {
            let mut cmd = Command::new(&self.default_shell);
            cmd.arg("-c").arg(&request.command);
            cmd
        };

        // 设置工作目录
        cmd.current_dir(&cwd);

        // 设置环境变量
        if let Some(env) = &request.env {
            cmd.envs(env);
        }

        // 配置输出捕获
        if request.capture_output {
            cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        }

        // 启动进程
        let mut child = cmd.spawn()?;
        let process_id = uuid::Uuid::new_v4().to_string();

        // 捕获输出
        let mut stdout_lines = Vec::new();
        let mut stderr_lines = Vec::new();
        let mut stdout_all = String::new();
        let mut stderr_all = String::new();

        if request.capture_output {
            let stdout = child.stdout.take()
                .ok_or_else(|| CliError::IoError("Failed to capture stdout".to_string()))?;
            let stderr = child.stderr.take()
                .ok_or_else(|| CliError::IoError("Failed to capture stderr".to_string()))?;

            let mut stdout_reader = BufReader::new(stdout).lines();
            let mut stderr_reader = BufReader::new(stderr).lines();

            // 读取输出
            loop {
                tokio::select! {
                    line = stdout_reader.next_line() => {
                        match line {
                            Ok(Some(line)) => {
                                stdout_lines.push(line.clone());
                                stdout_all.push_str(&line);
                                stdout_all.push('\n');
                                
                                if request.stream_output {
                                    // 发送流式输出
                                    println!("[STDOUT] {}", line);
                                }
                            }
                            Ok(None) => {}
                            Err(_) => break,
                        }
                    }
                    line = stderr_reader.next_line() => {
                        match line {
                            Ok(Some(line)) => {
                                stderr_lines.push(line.clone());
                                stderr_all.push_str(&line);
                                stderr_all.push('\n');
                                
                                if request.stream_output {
                                    // 发送流式输出
                                    eprintln!("[STDERR] {}", line);
                                }
                            }
                            Ok(None) => {}
                            Err(_) => break,
                        }
                    }
                    _ = tokio::time::sleep(tokio::time::Duration::from_millis(10)) => {
                        if child.try_wait()?.is_some() {
                            break;
                        }
                    }
                }
                
                // 检查超时
                if let Some(timeout) = request.timeout_ms {
                    if start.elapsed().as_millis() as u64 > timeout {
                        child.kill().await?;
                        return Err(CliError::Timeout(request.command));
                    }
                }
            }
        }

        // 等待进程完成
        let status = child.wait().await?;
        let completed_at = Utc::now();
        let duration_ms = start.elapsed().as_millis() as u64;

        Ok(ExecutionResult {
            success: status.success(),
            exit_code: status.code(),
            stdout: stdout_all,
            stderr: stderr_all,
            stdout_lines,
            stderr_lines,
            duration_ms,
            command: request.command,
            started_at,
            completed_at,
        })
    }

    /// 执行并解析结构化输出
    pub async fn execute_and_parse<T>(&self, request: ExecutionRequest) 
        -> Result<parser::ParsedOutput<T>, CliError> 
    where
        T: serde::de::DeserializeOwned,
    {
        let result = self.execute(request).await?;
        parser::parse_output(&result).map_err(CliError::ParseError)
    }

    /// 启动后台进程
    pub async fn spawn(&self, request: ExecutionRequest) -> Result<String, CliError> {
        let cwd = request.cwd.as_deref()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| self.working_dir.read().await.clone());

        let mut cmd = if cfg!(target_os = "windows") {
            let mut cmd = Command::new("cmd");
            cmd.arg("/C").arg(&request.command);
            cmd
        } else {
            let mut cmd = Command::new(&self.default_shell);
            cmd.arg("-c").arg(&request.command);
            cmd
        };

        cmd.current_dir(&cwd);
        
        if let Some(env) = &request.env {
            cmd.envs(env);
        }

        let child = cmd.spawn()?;
        let process_id = uuid::Uuid::new_v4().to_string();

        let process = RunningProcess {
            id: process_id.clone(),
            child,
            command: request.command,
            started_at: Utc::now(),
            stdout_buffer: Vec::new(),
            stderr_buffer: Vec::new(),
        };

        self.processes.write().await.insert(process_id.clone(), process);
        
        Ok(process_id)
    }

    /// 停止进程
    pub async fn kill(&self, process_id: &str) -> Result<(), CliError> {
        if let Some(mut process) = self.processes.write().await.remove(process_id) {
            process.child.kill().await?;
            Ok(())
        } else {
            Err(CliError::ProcessNotFound(process_id.to_string()))
        }
    }

    /// 获取进程列表
    pub async fn list_processes(&self) -> Vec<(String, String, DateTime<Utc>)> {
        let processes = self.processes.read().await;
        processes.iter()
            .map(|(id, p)| (id.clone(), p.command.clone(), p.started_at))
            .collect()
    }

    /// 设置工作目录
    pub async fn set_cwd(&self, path: impl AsRef<std::path::Path>) -> Result<(), CliError> {
        let path = path.as_ref().to_path_buf();
        if !path.exists() {
            return Err(CliError::InvalidPath(path.display().to_string()));
        }
        *self.working_dir.write().await = path;
        Ok(())
    }

    /// 获取工作目录
    pub async fn get_cwd(&self) -> std::path::PathBuf {
        self.working_dir.read().await.clone()
    }
}

/// CLI 错误
#[derive(Debug, thiserror::Error)]
pub enum CliError {
    #[error("IO error: {0}")]
    IoError(String),
    
    #[error("Command execution failed: {0}")]
    ExecutionFailed(String),
    
    #[error("Timeout: {0}")]
    Timeout(String),
    
    #[error("Process not found: {0}")]
    ProcessNotFound(String),
    
    #[error("Invalid path: {0}")]
    InvalidPath(String),
    
    #[error("Parse error: {0}")]
    ParseError(String),
}

impl From<std::io::Error> for CliError {
    fn from(e: std::io::Error) -> Self {
        CliError::IoError(e.to_string())
    }
}
