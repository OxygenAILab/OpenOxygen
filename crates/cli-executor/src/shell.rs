//! Shell 模块
//!
//! Shell 命令解析和环境管理

use crate::CliError;

/// Shell 类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellType {
    /// Windows PowerShell
    Powershell,
    /// Windows CMD
    Cmd,
    /// Bash
    Bash,
    /// Zsh
    Zsh,
    /// Fish
    Fish,
}

/// Shell 配置
#[derive(Debug, Clone)]
pub struct ShellConfig {
    pub shell_type: ShellType,
    pub shell_path: String,
    pub args: Vec<String>,
}

impl ShellConfig {
    /// 检测当前系统默认 shell
    pub fn detect() -> Self {
        #[cfg(target_os = "windows")]
        {
            Self {
                shell_type: ShellType::Powershell,
                shell_path: "powershell.exe".to_string(),
                args: vec!["-Command".to_string()],
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
            let shell_type = if shell.contains("zsh") {
                ShellType::Zsh
            } else if shell.contains("fish") {
                ShellType::Fish
            } else {
                ShellType::Bash
            };
            Self {
                shell_type,
                shell_path: shell,
                args: vec!["-c".to_string()],
            }
        }
    }

    /// 构建命令
    pub fn build_command(&self, command: &str) -> (String, Vec<String>) {
        (self.shell_path.clone(), [self.args.clone(), vec![command.to_string()]].concat())
    }

    /// 转义命令参数
    pub fn escape_arg(arg: &str) -> String {
        #[cfg(target_os = "windows")]
        {
            format!("\"{}\"", arg.replace('"', "\"\""))
        }
        #[cfg(not(target_os = "windows"))]
        {
            format!("'{}'", arg.replace('\'', "'\\''"))
        }
    }
}

impl Default for ShellConfig {
    fn default() -> Self {
        Self::detect()
    }
}

/// 执行 shell 命令并返回结果
pub async fn execute_shell(command: &str, cwd: Option<&str>) -> Result<(String, String, i32), CliError> {
    use tokio::process::Command;

    let config = ShellConfig::detect();
    let mut cmd = Command::new(&config.shell_path);
    cmd.args(&config.args);
    cmd.arg(command);

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    let output = cmd.output().await.map_err(|e| CliError::IoError(e.to_string()))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let code = output.status.code().unwrap_or(-1);

    Ok((stdout, stderr, code))
}
