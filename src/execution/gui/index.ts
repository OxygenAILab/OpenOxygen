export interface GUICoordinates {
  x: number;
  y: number;
}

export interface GUITarget {
  type: 'coordinates' | 'element' | 'description';
  value: GUICoordinates | string;
}

export interface ClickOptions {
  button?: 'left' | 'right' | 'middle';
  doubleClick?: boolean;
}

export interface TypeOptions {
  clearFirst?: boolean;
  delayMs?: number;
}

export interface ScrollOptions {
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;
}

export interface ScreenshotOptions {
  region?: { x: number; y: number; width: number; height: number };
  format?: 'png' | 'jpeg';
  quality?: number;
}

export interface GUIResult {
  success: boolean;
  output?: any;
  error?: string;
}

export class GUIController {
  private nativeController: any;

  constructor(nativeController?: any) {
    this.nativeController = nativeController;
  }

  async click(target: GUITarget, options: ClickOptions = {}): Promise<GUIResult> {
    const coords = await this.resolveTarget(target);
    
    try {
      if (this.nativeController) {
        await this.nativeController.click(coords.x, coords.y, options.button || 'left', options.doubleClick);
      } else {
        return { success: false, error: 'Native controller not available' };
      }
      
      return { success: true, output: { x: coords.x, y: coords.y, ...options } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async typeText(text: string, options: TypeOptions = {}): Promise<GUIResult> {
    try {
      if (this.nativeController) {
        if (options.clearFirst) {
          await this.nativeController.keyCombo('ctrl', 'a');
          await this.delay(100);
        }
        await this.nativeController.typeText(text, options.delayMs);
      } else {
        return { success: false, error: 'Native controller not available' };
      }
      
      return { success: true, output: { text, ...options } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async scroll(target: GUITarget, options: ScrollOptions = {}): Promise<GUIResult> {
    const coords = await this.resolveTarget(target);
    
    try {
      if (this.nativeController) {
        await this.nativeController.scroll(coords.x, coords.y, options.direction || 'down', options.amount);
      } else {
        return { success: false, error: 'Native controller not available' };
      }
      
      return { success: true, output: { x: coords.x, y: coords.y, ...options } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async waitFor(target: GUITarget, timeoutMs: number = 30000): Promise<GUIResult> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const coords = await this.resolveTarget(target);
        return { success: true, output: { found: true, x: coords.x, y: coords.y } };
      } catch {
        await this.delay(500);
      }
    }
    
    return { success: false, error: `Element not found within ${timeoutMs}ms` };
  }

  async screenshot(options: ScreenshotOptions = {}): Promise<GUIResult> {
    try {
      if (this.nativeController) {
        const result = await this.nativeController.screenshot(options.region, options.format || 'png', options.quality);
        return { success: true, output: result };
      } else {
        return { success: false, error: 'Native controller not available' };
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async keyCombo(...keys: string[]): Promise<GUIResult> {
    try {
      if (this.nativeController) {
        await this.nativeController.keyCombo(...keys);
      } else {
        return { success: false, error: 'Native controller not available' };
      }
      
      return { success: true, output: { keys } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async getElementInfo(target: GUITarget): Promise<GUIResult> {
    try {
      if (this.nativeController && this.nativeController.getElementInfo) {
        const info = await this.nativeController.getElementInfo(target);
        return { success: true, output: info };
      } else {
        return { success: false, error: 'Native controller not available or method not supported' };
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async resolveTarget(target: GUITarget): Promise<GUICoordinates> {
    if (target.type === 'coordinates') {
      return target.value as GUICoordinates;
    }

    if (target.type === 'description' && this.nativeController?.locateByDescription) {
      return await this.nativeController.locateByDescription(target.value as string);
    }

    throw new Error(`Cannot resolve target: ${JSON.stringify(target)}`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default GUIController;