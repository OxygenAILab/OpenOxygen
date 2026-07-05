/**
 * Node.js CLI 执行器
 *
 * 提供命令行命令的执行、spawn、kill 和状态查询能力。
 * 用于 orchestrator 执行计划中的 cli_execute / cli_execute_parsed 步骤。
 */

import { exec, spawn, ChildProcess } from 'child_process';

// ---------------------------------------------------------------------------
// 公开接口
// ---------------------------------------------------------------------------

export interface CliExecuteParams {
  /** 要执行的完整命令行（会经过 shell 解析） */
  command: string;
  /** 工作目录 */
  cwd?: string;
  /** 超时时间（毫秒），默认 60000（60 秒） */
  timeout?: number;
  /** 是否捕获输出，默认 true */
  captureOutput?: boolean;
  /** 额外的环境变量，会合并到当前进程环境中 */
  env?: Record<string, string>;
  /** 使用的 shell，默认 'powershell' */
  shell?: string;
}

export interface CliExecuteResult {
  /** 是否成功（exit_code === 0 且未超时） */
  success: boolean;
  /** 退出码，超时时为 -1 */
  exit_code: number;
  /** 标准输出 */
  stdout: string;
  /** 标准错误 */
  stderr: string;
  /** 执行耗时（毫秒） */
  duration_ms: number;
  /** 是否因超时被强制终止 */
  timed_out: boolean;
}

// ---------------------------------------------------------------------------
// NodeCliExecutor
// ---------------------------------------------------------------------------

/**
 * 基于 Node.js child_process 的 CLI 执行器。
 *
 * - execute：阻塞式执行命令，捕获 stdout / stderr，支持超时自动 kill
 * - spawn：启动长时间运行的进程，返回 PID
 * - kill：  按 PID 终止进程
 * - isRunning：检查指定 PID 是否仍在运行
 */
export class NodeCliExecutor {
  /** 当前正在运行的后台进程映射（由 spawn 创建） */
  private processes = new Map<string, ChildProcess>();

  // -----------------------------------------------------------------------
  // execute
  // -----------------------------------------------------------------------

  /**
   * 执行一条 shell 命令并等待完成。
   *
   * 内部使用 child_process.exec，默认超时 60 秒，超时后自动发送 SIGKILL。
   */
  async execute(params: CliExecuteParams): Promise<CliExecuteResult> {
    const {
      command,
      cwd,
      timeout = 60000,
      env,
      shell = 'powershell',
    } = params;

    const startTime = Date.now();
    let timed_out = false;

    return new Promise<CliExecuteResult>((resolve) => {
      const child = exec(
        command,
        {
          cwd,
          env: env ? { ...process.env, ...env } : process.env,
          shell,
          maxBuffer: 10 * 1024 * 1024, // 10MB 上限
        },
        (error, stdout, stderr) => {
          clearTimeout(timer);
          const duration_ms = Date.now() - startTime;

          resolve({
            success: !error && !timed_out,
            exit_code: error ? error.code ?? 1 : 0,
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            duration_ms,
            timed_out,
          });
        },
      );

      const timer = setTimeout(() => {
        timed_out = true;
        if (child.pid) {
          // Windows 上 process.kill 负号 PID 杀进程树
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        } else {
          child.kill('SIGKILL');
        }
      }, timeout);
    });
  }

  // -----------------------------------------------------------------------
  // spawn
  // -----------------------------------------------------------------------

  /**
   * 以后台方式启动命令，不等待完成，返回进程 PID。
   *
   * 适用于需要长时间运行的命令（如开发服务器）。
   * 启动的进程会被登记到内部映射表中，可通过 kill / isRunning 管理。
   */
  async spawn(params: CliExecuteParams): Promise<string> {
    const {
      command,
      cwd,
      env,
      shell = 'powershell',
    } = params;

    return new Promise<string>((resolve, reject) => {
      const child = spawn(command, [], {
        cwd,
        env: env ? { ...process.env, ...env } : process.env,
        shell,
        stdio: 'pipe',
      });

      const pid = String(child.pid);

      child.on('spawn', () => {
        this.processes.set(pid, child);
        resolve(pid);
      });

      child.on('error', (err) => {
        this.processes.delete(pid);
        reject(err);
      });

      child.on('exit', (_code, _signal) => {
        this.processes.delete(pid);
      });
    });
  }

  // -----------------------------------------------------------------------
  // kill
  // -----------------------------------------------------------------------

  /**
   * 终止指定 PID 的后台进程。
   *
   * 先发送 SIGTERM，等待 2 秒后若仍在运行则发送 SIGKILL 强制终止。
   * 返回 true 表示进程曾经存在且被终止，false 表示未找到对应进程。
   */
  async kill(pid: string): Promise<boolean> {
    const child = this.processes.get(pid);
    if (!child || child.killed || child.exitCode !== null) {
      this.processes.delete(pid);
      return false;
    }

    // 先尝试礼貌退出
    child.kill('SIGTERM');

    // 宽限期后强制终止
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        if (child.exitCode === null && !child.killed) {
          try {
            child.kill('SIGKILL');
          } catch {
            // 进程可能已经退出
          }
        }
        resolve();
      }, 2000);
    });

    this.processes.delete(pid);
    return true;
  }

  // -----------------------------------------------------------------------
  // isRunning
  // -----------------------------------------------------------------------

  /**
   * 检查指定 PID 的进程是否仍在运行。
   *
   * 优先通过内部映射表检查，再通过操作系统级别确认。
   */
  async isRunning(pid: string): Promise<boolean> {
    const child = this.processes.get(pid);
    if (child && !child.killed && child.exitCode === null) {
      return true;
    }

    // 操作系统级别探测：signal 0 不会真正发送信号，仅检查进程是否存在
    try {
      process.kill(Number(pid), 0);
      return true;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // 资源清理
  // -----------------------------------------------------------------------

  /**
   * 终止所有由 spawn 启动的后台进程并清空映射表。
   */
  async dispose(): Promise<void> {
    const pids = Array.from(this.processes.keys());
    for (const pid of pids) {
      await this.kill(pid);
    }
    this.processes.clear();
  }
}
