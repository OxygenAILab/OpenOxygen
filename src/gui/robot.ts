/**
 * GUI 控制器 - robotjs 实现（替代 PowerShell）
 *
 * 性能提升：PowerShell 每次启动进程 ~50ms → robotjs FFI 调用 ~1ms
 * 安全性提升：类型校验，防注入攻击
 */

import robot from 'robotjs';

export interface GuiActionResult {
  success: boolean;
  screenshot_before?: string;
  screenshot_after?: string;
  element_info?: any;
  error?: string;
}

/**
 * 判断文本是否为完整的 SendKeys 组合键表达式
 *
 * 支持（与 key_press 的解析规则一致）：
 *   #r        Win+R
 *   ^a ^{ESC}  Ctrl 组合
 *   %{F4}     Alt 组合
 *   +{TAB}    Shift 组合
 *   {ENTER} {ESC} {DELETE} 等单键
 *
 * 注意：仅当整串都是组合键语法时返回 true；
 * 混合内容（如 "Hello{ENTER}"）按字面文本输入处理。
 */
export function isSendKeysCombo(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0) {
    return false;
  }
  // 单键：{ENTER} / {ESC} 等（大写字母组成）
  if (/^\{[A-Z]+\}$/.test(text)) {
    return true;
  }
  // 组合键：修饰符前缀 + 键名（可带大括号），如 #r、^a、%{F4}、+{TAB}、^{ESC}
  return /^[#^+%]([A-Za-z0-9]|\{[A-Za-z0-9]+\})$/.test(text);
}

export class RobotGuiController {
  /**
   * 坐标校验 - 防止无效输入
   */
  private validateCoord(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`Invalid coordinate: (${x}, ${y}) - must be finite numbers`);
    }
    if (x < 0 || y < 0 || x > 10000 || y > 10000) {
      throw new Error(`Coordinate out of bounds: (${x}, ${y})`);
    }
  }

  /**
   * 移动鼠标到指定坐标
   */
  async move_mouse(x: number, y: number): Promise<GuiActionResult> {
    try {
      this.validateCoord(x, y);
      robot.moveMouse(Math.floor(x), Math.floor(y));
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 左键单击
   */
  async click(x: number, y: number): Promise<GuiActionResult> {
    try {
      this.validateCoord(x, y);
      robot.moveMouse(Math.floor(x), Math.floor(y));
      robot.mouseClick('left');
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 右键单击
   */
  async right_click(x: number, y: number): Promise<GuiActionResult> {
    try {
      this.validateCoord(x, y);
      robot.moveMouse(Math.floor(x), Math.floor(y));
      robot.mouseClick('right');
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 双击
   */
  async double_click(x: number, y: number): Promise<GuiActionResult> {
    try {
      this.validateCoord(x, y);
      robot.moveMouse(Math.floor(x), Math.floor(y));
      robot.mouseClick('left', true); // double click
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 输入文本
   *
   * 契约：整串为 SendKeys 组合键语法（如 "#r"、"^a"、"{ENTER}"）时
   * 自动路由到 key_press 执行按键，与 Planner 的 prompt 约定一致；
   * 其余内容按字面文本输入。
   */
  async type_text(text: string): Promise<GuiActionResult> {
    try {
      if (typeof text !== 'string') {
        throw new Error('Text must be a string');
      }
      if (isSendKeysCombo(text)) {
        return await this.key_press(text);
      }
      robot.typeString(text);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 按键（支持快捷键组合）
   *
   * 例子：
   *   key_press('a')        // 按 a 键
   *   key_press('^a')       // Ctrl+A（全选）
   *   key_press('^c')       // Ctrl+C（复制）
   *   key_press('^v')       // Ctrl+V（粘贴）
   *   key_press('%{F4}')    // Alt+F4（关闭窗口）
   *   key_press('#r')       // Win+R（运行对话框）
   *   key_press('{ENTER}')  // Enter 键
   */
  async key_press(key: string): Promise<GuiActionResult> {
    try {
      if (typeof key !== 'string' || key.length === 0) {
        throw new Error('Key must be a non-empty string');
      }

      // 处理特殊键名（大括号包裹）
      const specialKeyMatch = key.match(/^\{([A-Z]+)\}$/);
      if (specialKeyMatch) {
        const keyName = specialKeyMatch[1].toLowerCase();
        const keyMap: Record<string, string> = {
          'enter': 'enter',
          'return': 'enter',
          'tab': 'tab',
          'esc': 'escape',
          'escape': 'escape',
          'space': 'space',
          'backspace': 'backspace',
          'delete': 'delete',
          'up': 'up',
          'down': 'down',
          'left': 'left',
          'right': 'right',
          'home': 'home',
          'end': 'end',
          'pageup': 'pageup',
          'pagedown': 'pagedown',
        };
        const robotKey = keyMap[keyName];
        if (robotKey) {
          robot.keyTap(robotKey);
          return { success: true };
        }
      }

      // 解析快捷键格式（兼容 SendKeys 语法）
      if (key.startsWith('#')) {
        // Win + 字母（# 表示 Windows 键）
        const char = key.slice(1).toLowerCase();
        robot.keyTap(char, ['command']); // robotjs 用 'command' 表示 Win/Cmd 键
      } else if (key.startsWith('^')) {
        // Ctrl + 字母
        const char = key.slice(1).replace('{', '').replace('}', '').toLowerCase();
        robot.keyTap(char, ['control']);
      } else if (key.startsWith('%')) {
        // Alt + 字母
        const char = key.slice(1).replace('{', '').replace('}', '').toLowerCase();
        robot.keyTap(char, ['alt']);
      } else if (key.startsWith('+')) {
        // Shift + 字母
        const char = key.slice(1).toLowerCase();
        robot.keyTap(char, ['shift']);
      } else {
        // 单个按键
        const lower = key.toLowerCase();
        robot.keyTap(lower);
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 截图（返回 base64 PNG）
   */
  async screenshot(): Promise<string> {
    try {
      const size = robot.getScreenSize();
      const img = robot.screen.capture(0, 0, size.width, size.height);

      // robotjs 返回的是 bitmap 数据，需要转换为 PNG base64
      // 简化实现：先返回占位，后续可用 sharp/jimp 库转换
      const width = img.width;
      const height = img.height;
      const bytesPerPixel = img.bytesPerPixel;

      // 创建简单的 base64（生产环境应使用 PNG 编码库）
      const buffer = Buffer.from(img.image);
      return buffer.toString('base64');
    } catch (error) {
      throw new Error(`Screenshot failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 滚动鼠标滚轮
   */
  async scroll(amount: number): Promise<GuiActionResult> {
    try {
      if (!Number.isFinite(amount)) {
        throw new Error('Scroll amount must be a finite number');
      }
      robot.scrollMouse(0, Math.floor(amount));
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 获取当前鼠标位置
   */
  getMousePosition(): { x: number; y: number } {
    return robot.getMousePos();
  }

  /**
   * 获取屏幕尺寸
   */
  getScreenSize(): { width: number; height: number } {
    return robot.getScreenSize();
  }
}
