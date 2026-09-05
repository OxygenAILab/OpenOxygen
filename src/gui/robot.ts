/**
 * GUI 控制器 - robotjs 实现（替代 PowerShell）
 *
 * 性能提升：PowerShell 每次启动进程 ~50ms → robotjs FFI 调用 ~1ms
 * 安全性提升：类型校验，防注入攻击
 */

import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import robot from 'robotjs';

// ── PNG 编码（零依赖，Node 内置 zlib）─────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * 把 robotjs 的 BGRA 裸 bitmap 编码为合法 PNG(RGBA)。
 * 之前直接返回 bitmap base64 冒充 PNG,下游 VLM 永远收到损坏图像。
 *
 * @param downsample 降采样因子(2 = 2x2 合并为 1 像素,输出尺寸减半,数据量约 1/4)。
 *                   VLM 定位 1024 宽足够,且大幅降低请求体体积
 *                   (网关侧对 >~100KB 的请求体上游会拒收)。
 */
export function encodeBitmapToPng(
  width: number,
  height: number,
  bgra: Buffer,
  bytesPerPixel = 4,
  downsample = 1
): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`invalid bitmap dimensions: ${width}x${height}`);
  }
  const ds = Math.max(1, Math.floor(downsample));
  const outW = Math.floor(width / ds);
  const outH = Math.floor(height / ds);
  if (outW === 0 || outH === 0) {
    throw new Error(`bitmap too small for downsample ${ds}: ${width}x${height}`);
  }
  const stride = width * bytesPerPixel;
  if (bgra.length < stride * height) {
    throw new Error(`bitmap too small: ${bgra.length} < ${stride * height}`);
  }

  // 每行前置 filter byte 0(None),BGRA -> RGBA;降采样取每 ds×ds 块左上像素
  const raw = Buffer.alloc((outW * 4 + 1) * outH);
  for (let oy = 0; oy < outH; oy++) {
    const rowStart = oy * (outW * 4 + 1);
    raw[rowStart] = 0;
    const sy = oy * ds;
    for (let ox = 0; ox < outW; ox++) {
      const si = sy * stride + ox * ds * bytesPerPixel;
      const di = rowStart + 1 + ox * 4;
      raw[di] = bgra[si + 2]; // R
      raw[di + 1] = bgra[si + 1]; // G
      raw[di + 2] = bgra[si]; // B
      raw[di + 3] = bytesPerPixel === 4 ? bgra[si + 3] : 0xff; // A
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(outW, 0);
  ihdr.writeUInt32BE(outH, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

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
  // 单键：{ENTER} / {ESC} / {F5} 等（大写字母开头，可带数字，如功能键）
  if (/^\{[A-Z]+[0-9]*\}$/.test(text)) {
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
    // 允许负坐标：Windows 多显示器布局中副屏常位于主屏左侧/上方（负原点）。
    // 此校验的目的是防注入/NaN，不是严格桌面边界，因此对称放宽到 ±10000。
    if (x < -10000 || y < -10000 || x > 10000 || y > 10000) {
      throw new Error(`Coordinate out of bounds: (${x}, ${y})`);
    }
  }

  /**
   * 平滑移动鼠标:ease-out 减速插值,替代瞬间跳变
   * (实机观感:光标瞬移难以跟踪,平滑移动也便于人眼确认落点)
   */
  private async moveSmooth(x: number, y: number): Promise<void> {
    const from = robot.getMousePos();
    const dist = Math.hypot(x - from.x, y - from.y);
    const steps = Math.min(28, Math.max(6, Math.round(dist / 45)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const ease = 1 - (1 - t) * (1 - t); // ease-out quad:快起步缓减速
      robot.moveMouse(
        Math.round(from.x + (x - from.x) * ease),
        Math.round(from.y + (y - from.y) * ease)
      );
      await this.sleep(Math.max(4, Math.round(14 * (1 - t))));
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 移动鼠标到指定坐标(平滑)
   */
  async move_mouse(x: number, y: number): Promise<GuiActionResult> {
    try {
      this.validateCoord(x, y);
      await this.moveSmooth(Math.floor(x), Math.floor(y));
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
      await this.moveSmooth(Math.floor(x), Math.floor(y));
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
      await this.moveSmooth(Math.floor(x), Math.floor(y));
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
      await this.moveSmooth(Math.floor(x), Math.floor(y));
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
   * 其余内容走剪贴板粘贴通道。
   *
   * 为什么字面文本不用 typeString 逐键输入：中文 IME 激活时会拦截
   * 逐键事件进入合成（实机复现："world" 被打成 "ddddd"）。
   * 剪贴板粘贴（Set-Clipboard + ^v）完全绕开 IME，对任意 Unicode 安全。
   */
  async type_text(text: string): Promise<GuiActionResult> {
    try {
      if (typeof text !== 'string' || text.length === 0) {
        throw new Error('Text must be a non-empty string');
      }
      if (isSendKeysCombo(text)) {
        return await this.key_press(text);
      }

      // 剪贴板粘贴通道:EncodedCommand 传参(base64 of UTF-16LE),任意字符零转义风险
      const b64 = Buffer.from(text, 'utf16le').toString('base64');
      const ps = `Set-Clipboard -Value ([System.Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b64}')))`;
      execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')],
        { timeout: 8000, windowsHide: true }
      );
      await this.sleep(60); // 剪贴板落稳
      const paste = await this.key_press('^v');
      if (!paste.success) {
        return { success: false, error: `粘贴失败: ${paste.error}` };
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

      // 处理特殊键名（大括号包裹，含功能键 {F1}-{F12}）
      const specialKeyMatch = key.match(/^\{([A-Z]+[0-9]*)\}$/);
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
          'f1': 'f1', 'f2': 'f2', 'f3': 'f3', 'f4': 'f4',
          'f5': 'f5', 'f6': 'f6', 'f7': 'f7', 'f8': 'f8',
          'f9': 'f9', 'f10': 'f10', 'f11': 'f11', 'f12': 'f12',
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
        // Shift + 键（与 Ctrl/Alt 分支一致：剥离大括号，否则 {TAB} 会作为字面键名传入）
        const char = key.slice(1).replace('{', '').replace('}', '').toLowerCase();
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
   * 截图(返回 base64 PNG,2x 降采样至半宽以控制请求体体积与编码耗时)
   */
  async screenshot(): Promise<string> {
    try {
      const size = robot.getScreenSize();
      const img = robot.screen.capture(0, 0, size.width, size.height);

      // robotjs 返回 BGRA 裸 bitmap,必须编码为真正的 PNG 并降采样
      // (此前直接返回 bitmap base64 冒充 PNG,下游 VLM 收到的是损坏图像;
      //  且全尺寸 PNG 会超过网关 ~100KB 请求体上限)
      return encodeBitmapToPng(
        img.width,
        img.height,
        Buffer.from(img.image),
        img.bytesPerPixel || 4,
        2
      ).toString('base64');
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
