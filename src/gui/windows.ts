/**
 * Windows GUI 控制器 —— 通过 PowerShell 调用 Win32 / .NET / UIA 实现桌面自动化
 */

import { execFileSync } from 'child_process';

// ── 公共接口 ──────────────────────────────────────────────

export interface GuiActionResult {
  success: boolean;
  screenshot_before?: string; // base64
  screenshot_after?: string; // base64
  element_info?: any;
  error?: string;
}

// ── SendKeys 特殊字符转义映射 ─────────────────────────────

const SENDKEYS_ESCAPE: Record<string, string> = {
  '+': '{+}',
  '^': '{^}',
  '%': '{%}',
  '~': '{~}',
  '(': '{(}',
  ')': '{)}',
  '{': '{{}',
  '}': '{}}',
};

function escapeSendKeys(text: string): string {
  let result = '';
  for (const ch of text) {
    result += SENDKEYS_ESCAPE[ch] || ch;
  }
  return result;
}

// ── 鼠标事件常量 ──────────────────────────────────────────

const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_RIGHTDOWN = 0x0008;
const MOUSEEVENTF_RIGHTUP = 0x0010;
const MOUSEEVENTF_WHEEL = 0x0800;

// ── PowerShell 片段 ───────────────────────────────────────

const PS_ADD_FORMS =
  'Add-Type -AssemblyName System.Windows.Forms';

const PS_ADD_DRAWING =
  'Add-Type -AssemblyName System.Drawing';

const PS_ADD_UIA = [
  'Add-Type -AssemblyName UIAutomationClient',
  'Add-Type -AssemblyName UIAutomationTypes',
].join(';');

const PS_DECLARE_MOUSE = `
Add-Type -Name User32 -Namespace Win32 -MemberDefinition @'
[DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
'@
`;

const PS_SCREENSHOT = `
${PS_ADD_FORMS};
${PS_ADD_DRAWING};
$scr = [System.Windows.Forms.SystemInformation]::VirtualScreen;
$bmp = New-Object System.Drawing.Bitmap($scr.Width, $scr.Height);
$g = [System.Drawing.Graphics]::FromImage($bmp);
$g.CopyFromScreen($scr.Left, $scr.Top, 0, 0, $scr.Size);
$g.Dispose();
$ms = New-Object System.IO.MemoryStream;
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png);
$bmp.Dispose();
[Convert]::ToBase64String($ms.ToArray())
`;

// ── 控制器类 ──────────────────────────────────────────────

export class WindowsGuiController {
  /**
   * 执行一段 PowerShell 脚本，返回 stdout（已 trim）
   */
  private ps(script: string, timeoutMs: number = 30000): string {
    const result = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `$ProgressPreference = 'SilentlyContinue'; ${script}`],
      {
        encoding: 'utf-8',
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 50 * 1024 * 1024,
      }
    );
    return result.trim();
  }

  /**
   * 执行 PowerShell 并尝试解析为 JSON
   */
  private psJson(script: string, timeoutMs: number = 30000): any {
    const output = this.ps(script, timeoutMs);
    if (!output) return null;
    try {
      return JSON.parse(output);
    } catch {
      return null;
    }
  }

  /**
   * 将字符串安全地嵌入 PowerShell 单引号字符串中
   */
  private psQuote(s: string): string {
    return s.replace(/'/g, "''");
  }

  // ── 鼠标操作 ──────────────────────────────────────────

  async click(x: number, y: number): Promise<GuiActionResult> {
    try {
      this.ps(`
        ${PS_ADD_FORMS};
        ${PS_DECLARE_MOUSE}
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y});
        Start-Sleep -Milliseconds 30;
        [Win32.User32]::mouse_event(${MOUSEEVENTF_LEFTDOWN}, 0, 0, 0, 0);
        Start-Sleep -Milliseconds 50;
        [Win32.User32]::mouse_event(${MOUSEEVENTF_LEFTUP}, 0, 0, 0, 0);
      `);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async double_click(x: number, y: number): Promise<GuiActionResult> {
    try {
      this.ps(`
        ${PS_ADD_FORMS};
        ${PS_DECLARE_MOUSE}
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y});
        Start-Sleep -Milliseconds 30;
        [Win32.User32]::mouse_event(${MOUSEEVENTF_LEFTDOWN}, 0, 0, 0, 0);
        [Win32.User32]::mouse_event(${MOUSEEVENTF_LEFTUP}, 0, 0, 0, 0);
        Start-Sleep -Milliseconds 50;
        [Win32.User32]::mouse_event(${MOUSEEVENTF_LEFTDOWN}, 0, 0, 0, 0);
        [Win32.User32]::mouse_event(${MOUSEEVENTF_LEFTUP}, 0, 0, 0, 0);
      `);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async right_click(x: number, y: number): Promise<GuiActionResult> {
    try {
      this.ps(`
        ${PS_ADD_FORMS};
        ${PS_DECLARE_MOUSE}
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y});
        Start-Sleep -Milliseconds 30;
        [Win32.User32]::mouse_event(${MOUSEEVENTF_RIGHTDOWN}, 0, 0, 0, 0);
        Start-Sleep -Milliseconds 50;
        [Win32.User32]::mouse_event(${MOUSEEVENTF_RIGHTUP}, 0, 0, 0, 0);
      `);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async move_mouse(x: number, y: number): Promise<GuiActionResult> {
    try {
      this.ps(`
        ${PS_ADD_FORMS};
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y});
      `);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async scroll(x: number, y: number, delta: number): Promise<GuiActionResult> {
    try {
      this.ps(`
        ${PS_ADD_FORMS};
        ${PS_DECLARE_MOUSE}
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y});
        Start-Sleep -Milliseconds 20;
        [Win32.User32]::mouse_event(${MOUSEEVENTF_WHEEL}, 0, 0, ${delta}, 0);
      `);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // ── 键盘操作 ──────────────────────────────────────────

  async type_text(text: string): Promise<GuiActionResult> {
    try {
      const escaped = escapeSendKeys(text);
      this.ps(`
        ${PS_ADD_FORMS};
        [System.Windows.Forms.SendKeys]::SendWait('${this.psQuote(escaped)}');
      `);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async key_press(key: string): Promise<GuiActionResult> {
    try {
      const escaped = escapeSendKeys(key);
      this.ps(`
        ${PS_ADD_FORMS};
        [System.Windows.Forms.SendKeys]::SendWait('${this.psQuote(escaped)}');
      `);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // ── 截图 ──────────────────────────────────────────────

  /**
   * 返回当前屏幕截图的 base64 PNG 字符串（不含换行）
   */
  async screenshot(): Promise<string> {
    const raw = this.ps(PS_SCREENSHOT, 15000);
    // 移除 PowerShell 可能插入的换行
    return raw.replace(/[\r\n]/g, '');
  }

  // ── 窗口 / 进程操作 ────────────────────────────────────

  async launch_app(appName: string): Promise<GuiActionResult> {
    try {
      this.ps(`Start-Process '${this.psQuote(appName)}'`);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async get_active_window(): Promise<any> {
    try {
      const result = this.ps(`
        ${PS_ADD_UIA};
        $focused = [System.Windows.Automation.AutomationElement]::FocusedElement;
        if ($focused -eq $null) { return 'null' }
        $window = $focused;
        while ($window -ne $null) {
          $cp = $window.Current.ControlType.ProgrammaticName;
          if ($cp -eq 'Window' -or $cp -eq 'ControlType.Window') { break }
          $window = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($window);
        }
        if ($window -eq $null) { $window = $focused }
        @{
          Name = $window.Current.Name;
          AutomationId = $window.Current.AutomationId;
          ClassName = $window.Current.ClassName;
          BoundingRectangle = @{
            X = $window.Current.BoundingRectangle.X;
            Y = $window.Current.BoundingRectangle.Y;
            Width = $window.Current.BoundingRectangle.Width;
            Height = $window.Current.BoundingRectangle.Height;
          };
          IsEnabled = $window.Current.IsEnabled;
          ProcessId = $window.Current.ProcessId;
        } | ConvertTo-Json -Compress
      `);
      return result ? JSON.parse(result) : null;
    } catch {
      return null;
    }
  }

  async get_all_windows(): Promise<any[]> {
    try {
      const result = this.ps(`
        Get-Process |
          Where-Object { $_.MainWindowTitle -ne '' } |
          Select-Object Id, MainWindowTitle, ProcessName |
          ConvertTo-Json -Compress
      `);
      if (!result) return [];
      const parsed = JSON.parse(result);
      // ConvertTo-Json 在单个对象时不包在数组里
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }

  // ── 元素查找 ──────────────────────────────────────────

  async find_element(description: string): Promise<any> {
    const desc = this.psQuote(description);

    // 策略 1: 精确匹配 Name
    let script = `
      ${PS_ADD_UIA};
      $desc = '${desc}';
      $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty, $desc);
      $root = [System.Windows.Automation.AutomationElement]::RootElement;
      $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond);
      if ($el -ne $null) {
        return (ConvertTo-Json -Compress @{
          Name = $el.Current.Name;
          AutomationId = $el.Current.AutomationId;
          ClassName = $el.Current.ClassName;
          ControlType = $el.Current.ControlType.ProgrammaticName;
          BoundingRectangle = @{
            X = $el.Current.BoundingRectangle.X;
            Y = $el.Current.BoundingRectangle.Y;
            Width = $el.Current.BoundingRectangle.Width;
            Height = $el.Current.BoundingRectangle.Height;
          };
          IsEnabled = $el.Current.IsEnabled;
        })
      }
    `;
    let result = this.ps(script);
    if (result) {
      try { return JSON.parse(result); } catch { /* continue */ }
    }

    // 策略 2: 模糊匹配（遍历顶层窗口，Name 包含 description）
    script = `
      ${PS_ADD_UIA};
      $desc = '${desc}';
      $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Window);
      $root = [System.Windows.Automation.AutomationElement]::RootElement;
      $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond);
      foreach ($w in $windows) {
        $n = $w.Current.Name;
        if ($n -and $n.Contains($desc)) {
          return (ConvertTo-Json -Compress @{
            Name = $w.Current.Name;
            AutomationId = $w.Current.AutomationId;
            ClassName = $w.Current.ClassName;
            ControlType = $w.Current.ControlType.ProgrammaticName;
            BoundingRectangle = @{
              X = $w.Current.BoundingRectangle.X;
              Y = $w.Current.BoundingRectangle.Y;
              Width = $w.Current.BoundingRectangle.Width;
              Height = $w.Current.BoundingRectangle.Height;
            };
            IsEnabled = $w.Current.IsEnabled;
          })
        }
      }
    `;
    result = this.ps(script);
    if (result) {
      try { return JSON.parse(result); } catch { /* continue */ }
    }

    // 策略 3: 通过 Get-Process 查找窗口标题
    script = `
      $desc = '${desc}';
      $procs = Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Contains($desc) };
      if ($procs) {
        $p = $procs | Select-Object -First 1;
        return (ConvertTo-Json -Compress @{
          ProcessId = $p.Id;
          ProcessName = $p.ProcessName;
          MainWindowTitle = $p.MainWindowTitle;
        })
      }
    `;
    result = this.ps(script);
    if (result) {
      try { return JSON.parse(result); } catch { /* continue */ }
    }

    return null;
  }

  async wait_for_element(description: string, timeout: number = 10000): Promise<any> {
    const start = Date.now();
    const pollInterval = 500;

    while (Date.now() - start < timeout) {
      const el = await this.find_element(description);
      if (el) return el;
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    return null;
  }

  /**
   * 通过描述定位元素并返回其中心点坐标（UIA 路径）
   *
   * 优先走系统级 UIA（准确、零 VLM 开销）。找不到、或元素无有效
   * BoundingRectangle 时返回 null，交由上层决定是否走视觉兜底。
   */
  async locateByDescription(description: string): Promise<{ x: number; y: number } | null> {
    const el = await this.find_element(description);
    return WindowsGuiController.centerOfElement(el);
  }

  /**
   * 从 UIA 元素的 BoundingRectangle 计算中心点。
   *
   * find_element 的策略 1/2 返回带 BoundingRectangle 的对象，策略 3
   * （Get-Process 兜底）只有 ProcessId，无坐标 —— 此时返回 null。
   */
  static centerOfElement(el: any): { x: number; y: number } | null {
    const rect = el?.BoundingRectangle;
    if (!rect) return null;

    const { X, Y, Width, Height } = rect;
    if (
      typeof X !== 'number' ||
      typeof Y !== 'number' ||
      typeof Width !== 'number' ||
      typeof Height !== 'number'
    ) {
      return null;
    }

    // UIA 对屏外/隐藏元素会返回非常大的坐标（如 int.MaxValue），过滤掉
    if (Width <= 0 || Height <= 0 || !Number.isFinite(X) || !Number.isFinite(Y)) {
      return null;
    }

    return {
      x: Math.round(X + Width / 2),
      y: Math.round(Y + Height / 2),
    };
  }
}
