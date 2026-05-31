/**
 * Playwright CDP 浏览器控制器
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { EventEmitter } from 'events';

export interface BrowserOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
  userAgent?: string;
  proxy?: { server: string; username?: string; password?: string };
  downloadsPath?: string;
}

export interface BrowserResult {
  success: boolean;
  url: string;
  title: string;
  screenshot?: string;
  executionTimeMs: number;
}

export interface PageSource {
  html: string;
  text: string;
  links: Array<{ text: string; href: string }>;
  forms: Array<{ id: string; action: string; inputs: string[] }>;
}

export class PlaywrightController extends EventEmitter {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private options: BrowserOptions;

  constructor(options: BrowserOptions = {}) {
    super();
    this.options = {
      headless: false,
      viewport: { width: 1920, height: 1080 },
      ...options,
    };
  }

  /**
   * 启动浏览器
   */
  async launch(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.options.headless,
      downloadsPath: this.options.downloadsPath,
      proxy: this.options.proxy,
    });

    this.context = await this.browser.newContext({
      viewport: this.options.viewport,
      userAgent: this.options.userAgent,
    });

    this.page = await this.context.newPage();

    // 设置默认超时
    this.page.setDefaultTimeout(30000);
    this.page.setDefaultNavigationTimeout(30000);

    this.emit('launched');
  }

  /**
   * 导航到 URL
   */
  async navigate(url: string): Promise<BrowserResult> {
    const start = Date.now();

    if (!this.page) {
      throw new Error('Browser not launched');
    }

    try {
      await this.page.goto(url, { waitUntil: 'networkidle' });
      
      const currentUrl = this.page.url();
      const title = await this.page.title();

      this.emit('navigated', { url: currentUrl, title });

      return {
        success: true,
        url: currentUrl,
        title,
        executionTimeMs: Date.now() - start,
      };
    } catch (error) {
      return {
        success: false,
        url: this.page.url(),
        title: await this.page.title().catch(() => ''),
        executionTimeMs: Date.now() - start,
      };
    }
  }

  /**
   * 点击元素
   */
  async click(selector: string): Promise<BrowserResult> {
    const start = Date.now();

    if (!this.page) {
      throw new Error('Browser not launched');
    }

    try {
      // 等待元素可见
      await this.page.waitForSelector(selector, { state: 'visible' });
      
      // 滚动到元素
      await this.page.locator(selector).scrollIntoViewIfNeeded();
      
      // 点击
      await this.page.click(selector);

      return {
        success: true,
        url: this.page.url(),
        title: await this.page.title(),
        executionTimeMs: Date.now() - start,
      };
    } catch (error) {
      return {
        success: false,
        url: this.page?.url() || '',
        title: await this.page?.title().catch(() => '') || '',
        executionTimeMs: Date.now() - start,
      };
    }
  }

  /**
   * 输入文本
   */
  async typeText(selector: string, text: string): Promise<BrowserResult> {
    const start = Date.now();

    if (!this.page) {
      throw new Error('Browser not launched');
    }

    try {
      // 聚焦元素
      await this.page.locator(selector).focus();
      
      // 清空现有文本
      await this.page.locator(selector).fill('');
      
      // 输入新文本
      await this.page.locator(selector).fill(text);

      return {
        success: true,
        url: this.page.url(),
        title: await this.page.title(),
        executionTimeMs: Date.now() - start,
      };
    } catch (error) {
      return {
        success: false,
        url: this.page?.url() || '',
        title: await this.page?.title().catch(() => '') || '',
        executionTimeMs: Date.now() - start,
      };
    }
  }

  /**
   * 获取页面源码
   */
  async getPageSource(): Promise<PageSource> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    const html = await this.page.content();
    const text = await this.page.evaluate(() => document.body.innerText);
    
    // 提取链接
    const links = await this.page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]')).map(a => ({
        text: a.textContent?.trim() || '',
        href: (a as HTMLAnchorElement).href,
      }));
    });

    // 提取表单
    const forms = await this.page.evaluate(() => {
      return Array.from(document.querySelectorAll('form')).map(form => ({
        id: form.id,
        action: (form as HTMLFormElement).action,
        inputs: Array.from(form.querySelectorAll('input, textarea, select'))
          .map(i => (i as HTMLInputElement).name || (i as HTMLInputElement).id)
          .filter(Boolean),
      }));
    });

    return { html, text, links, forms };
  }

  /**
   * 执行 JavaScript
   */
  async evaluate(script: string): Promise<any> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    return await this.page.evaluate((code) => {
      return eval(code);
    }, script);
  }

  /**
   * 截图
   */
  async screenshot(fullPage: boolean = false): Promise<string> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    const buffer = await this.page.screenshot({
      fullPage,
      type: 'png',
    });

    return buffer.toString('base64');
  }

  /**
   * 等待元素
   */
  async waitForSelector(selector: string, timeout: number = 30000): Promise<boolean> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    try {
      await this.page.waitForSelector(selector, { timeout });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 等待导航
   */
  async waitForNavigation(timeout: number = 30000): Promise<boolean> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    try {
      await this.page.waitForLoadState('networkidle', { timeout });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取当前 URL
   */
  getCurrentUrl(): string {
    return this.page?.url() || '';
  }

  /**
   * 获取页面标题
   */
  async getTitle(): Promise<string> {
    return await this.page?.title() || '';
  }

  /**
   * 前进
   */
  async goForward(): Promise<void> {
    await this.page?.goForward();
  }

  /**
   * 后退
   */
  async goBack(): Promise<void> {
    await this.page?.goBack();
  }

  /**
   * 刷新
   */
  async reload(): Promise<void> {
    await this.page?.reload();
  }

  /**
   * 关闭浏览器
   */
  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
    this.emit('closed');
  }

  /**
   * 新标签页
   */
  async newPage(): Promise<Page> {
    if (!this.context) {
      throw new Error('Browser not launched');
    }
    return await this.context.newPage();
  }

  /**
   * 获取所有页面
   */
  async getPages(): Promise<Page[]> {
    return this.context?.pages() || [];
  }

  /**
   * 切换到页面
   */
  async switchToPage(index: number): Promise<void> {
    const pages = await this.getPages();
    if (index < pages.length) {
      this.page = pages[index];
      await this.page.bringToFront();
    }
  }

  /**
   * 下载文件
   */
  async downloadFile(selector: string): Promise<{ filename: string; data: Buffer }> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.page.click(selector),
    ]);

    const path = await download.path();
    const filename = download.suggestedFilename();
    
    if (path) {
      const data = await fs.promises.readFile(path);
      return { filename, data };
    }
    
    throw new Error('Download failed');
  }

  /**
   * 上传文件
   */
  async uploadFile(selector: string, filePath: string): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    const input = await this.page.locator(selector);
    await input.setInputFiles(filePath);
  }

  /**
   * 滚动到元素
   */
  async scrollToElement(selector: string): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    await this.page.locator(selector).scrollIntoViewIfNeeded();
  }

  /**
   * 获取元素文本
   */
  async getElementText(selector: string): Promise<string> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    return await this.page.locator(selector).innerText();
  }

  /**
   * 元素是否存在
   */
  async elementExists(selector: string): Promise<boolean> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    const count = await this.page.locator(selector).count();
    return count > 0;
  }

  /**
   * 获取元素数量
   */
  async getElementCount(selector: string): Promise<number> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    return await this.page.locator(selector).count();
  }

  /**
   * 按文本点击
   */
  async clickByText(text: string): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    await this.page.getByText(text).click();
  }

  /**
   * 按标签点击
   */
  async clickByLabel(label: string): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    await this.page.getByLabel(label).click();
  }

  /**
   * 按占位符点击
   */
  async clickByPlaceholder(placeholder: string): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    await this.page.getByPlaceholder(placeholder).click();
  }
}

import * as fs from 'fs';
