/**
 * Playwright CDP 浏览器控制器
 *
 * 基于 Playwright 的真实浏览器自动化实现
 */

import { EventEmitter } from "events";
import { chromium, Browser, BrowserContext, Page, Download } from "playwright";
import * as path from "path";
import * as fs from "fs";
import { promisify } from "util";
import { exec } from "child_process";
import * as crypto from "crypto";
import Database from "better-sqlite3";

const execAsync = promisify(exec);

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

interface CookieData {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export class PlaywrightController extends EventEmitter {
  private options: BrowserOptions;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private currentPage: Page | null = null;
  private masterKey: Buffer | null = null;

  constructor(options: BrowserOptions = {}) {
    super();
    this.options = {
      headless: false,
      viewport: { width: 1920, height: 1080 },
      ...options,
    };
  }

  async launch(): Promise<void> {
    try {
      this.browser = await chromium.launch({
        headless: this.options.headless,
        proxy: this.options.proxy,
      });

      this.context = await this.browser.newContext({
        viewport: this.options.viewport,
        userAgent: this.options.userAgent,
        acceptDownloads: true,
      });

      this.currentPage = await this.context.newPage();
    } catch (error) {
      throw new Error(
        `Failed to launch browser: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private ensurePage(): Page {
    if (!this.currentPage) {
      throw new Error("Browser not launched. Call launch() first.");
    }
    return this.currentPage;
  }

  private async createBrowserResult(
    includeScreenshot: boolean = false,
  ): Promise<BrowserResult> {
    const page = this.ensurePage();
    const startTime = Date.now();

    const url = page.url();
    const title = await page.title();
    let screenshot: string | undefined;

    if (includeScreenshot) {
      const buffer = await page.screenshot({ fullPage: false });
      screenshot = buffer.toString("base64");
    }

    const executionTimeMs = Date.now() - startTime;

    return {
      success: true,
      url,
      title,
      screenshot,
      executionTimeMs,
    };
  }

  async navigate(url: string): Promise<BrowserResult> {
    const startTime = Date.now();
    try {
      const page = this.ensurePage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

      const title = await page.title();
      const buffer = await page.screenshot({ fullPage: false });
      const screenshot = buffer.toString("base64");

      return {
        success: true,
        url: page.url(),
        title,
        screenshot,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        url,
        title: "",
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  async click(selector: string): Promise<BrowserResult> {
    const startTime = Date.now();
    try {
      const page = this.ensurePage();
      await page.click(selector, { timeout: 10000 });
      await page.waitForLoadState("domcontentloaded");

      return {
        success: true,
        url: page.url(),
        title: await page.title(),
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        url: this.getCurrentUrl(),
        title: await this.getTitle(),
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  async typeText(selector: string, text: string): Promise<BrowserResult> {
    const startTime = Date.now();
    try {
      const page = this.ensurePage();
      await page.fill(selector, text, { timeout: 10000 });

      return {
        success: true,
        url: page.url(),
        title: await page.title(),
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        url: this.getCurrentUrl(),
        title: await this.getTitle(),
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  async getPageSource(): Promise<PageSource> {
    const page = this.ensurePage();

    const html = await page.content();
    const text = await page.innerText("body").catch(() => "");

    const links = (await page.evaluate(`
      Array.from(document.querySelectorAll('a')).map(a => ({
        text: a.textContent?.trim() || '',
        href: a.href,
      }))
    `)) as Array<{ text: string; href: string }>;

    const forms = (await page.evaluate(`
      Array.from(document.querySelectorAll('form')).map(form => ({
        id: form.id || '',
        action: form.action || '',
        inputs: Array.from(form.querySelectorAll('input, textarea, select')).map(input =>
          input.name || input.id || ''
        ),
      }))
    `)) as Array<{ id: string; action: string; inputs: string[] }>;

    return { html, text, links, forms };
  }

  async evaluate(script: string): Promise<any> {
    const page = this.ensurePage();
    return await page.evaluate(script);
  }

  async screenshot(fullPage: boolean = false): Promise<string> {
    const page = this.ensurePage();
    const buffer = await page.screenshot({ fullPage });
    return buffer.toString("base64");
  }

  async waitForSelector(
    selector: string,
    timeout: number = 30000,
  ): Promise<boolean> {
    try {
      const page = this.ensurePage();
      await page.waitForSelector(selector, { timeout });
      return true;
    } catch (error) {
      return false;
    }
  }

  async waitForNavigation(timeout: number = 30000): Promise<boolean> {
    try {
      const page = this.ensurePage();
      await page.waitForLoadState("domcontentloaded", { timeout });
      return true;
    } catch (error) {
      return false;
    }
  }

  getCurrentUrl(): string {
    try {
      const page = this.ensurePage();
      return page.url();
    } catch {
      return "";
    }
  }

  async getTitle(): Promise<string> {
    try {
      const page = this.ensurePage();
      return await page.title();
    } catch {
      return "";
    }
  }

  async goForward(): Promise<void> {
    const page = this.ensurePage();
    await page.goForward();
  }

  async goBack(): Promise<void> {
    const page = this.ensurePage();
    await page.goBack();
  }

  async reload(): Promise<void> {
    const page = this.ensurePage();
    await page.reload();
  }

  async close(): Promise<void> {
    try {
      if (this.context) {
        await this.context.close();
        this.context = null;
      }
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      this.currentPage = null;
      this.emit("closed");
    } catch (error) {
      // Ignore errors during cleanup
    }
  }

  async newPage(): Promise<Page> {
    if (!this.context) {
      throw new Error("Browser context not available. Call launch() first.");
    }
    const page = await this.context.newPage();
    this.currentPage = page;
    return page;
  }

  async getPages(): Promise<Page[]> {
    if (!this.context) {
      return [];
    }
    return this.context.pages();
  }

  async switchToPage(index: number): Promise<void> {
    const pages = await this.getPages();
    if (index >= 0 && index < pages.length) {
      this.currentPage = pages[index];
    } else {
      throw new Error(
        `Invalid page index: ${index}. Available pages: ${pages.length}`,
      );
    }
  }

  async downloadFile(
    selector: string,
  ): Promise<{ filename: string; data: Buffer }> {
    const page = this.ensurePage();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click(selector),
    ]);

    const filename = download.suggestedFilename();
    const downloadPath = await download.path();

    if (!downloadPath) {
      throw new Error("Download failed: no file path");
    }

    const data = fs.readFileSync(downloadPath);
    return { filename, data };
  }

  async uploadFile(selector: string, filePath: string): Promise<void> {
    const page = this.ensurePage();
    await page.setInputFiles(selector, filePath);
  }

  async scrollToElement(selector: string): Promise<void> {
    const page = this.ensurePage();
    await page.locator(selector).scrollIntoViewIfNeeded();
  }

  async getElementText(selector: string): Promise<string> {
    try {
      const page = this.ensurePage();
      return (await page.textContent(selector)) || "";
    } catch {
      return "";
    }
  }

  async elementExists(selector: string): Promise<boolean> {
    try {
      const page = this.ensurePage();
      const count = await page.locator(selector).count();
      return count > 0;
    } catch {
      return false;
    }
  }

  async getElementCount(selector: string): Promise<number> {
    try {
      const page = this.ensurePage();
      return await page.locator(selector).count();
    } catch {
      return 0;
    }
  }

  async clickByText(text: string): Promise<void> {
    const page = this.ensurePage();
    await page.getByText(text).click();
  }

  async clickByLabel(label: string): Promise<void> {
    const page = this.ensurePage();
    await page.getByLabel(label).click();
  }

  async clickByPlaceholder(placeholder: string): Promise<void> {
    const page = this.ensurePage();
    await page.getByPlaceholder(placeholder).click();
  }

  /**
   * 从主流浏览器导入 Cookie
   * @param browserType 浏览器类型：chrome, edge, firefox
   */
  async importCookies(
    browserType: "chrome" | "edge" | "firefox",
  ): Promise<void> {
    if (!this.context) {
      throw new Error("Browser context not available. Call launch() first.");
    }

    const cookies = await this.readBrowserCookies(browserType);
    await this.context.addCookies(cookies);
  }

  /**
   * 读取浏览器 Cookie 数据库
   */
  private async readBrowserCookies(
    browserType: "chrome" | "edge" | "firefox",
  ): Promise<CookieData[]> {
    const cookiePaths: Record<string, string> = {
      chrome: path.join(
        process.env.LOCALAPPDATA || "",
        "Google",
        "Chrome",
        "User Data",
        "Default",
        "Network",
        "Cookies",
      ),
      edge: path.join(
        process.env.LOCALAPPDATA || "",
        "Microsoft",
        "Edge",
        "User Data",
        "Default",
        "Network",
        "Cookies",
      ),
      firefox: "", // Firefox uses different storage
    };

    const cookiePath = cookiePaths[browserType];

    if (!cookiePath || !fs.existsSync(cookiePath)) {
      throw new Error(`Cookie database not found for ${browserType}`);
    }

    // Load the AES master key from the browser's Local State (for v10/v11 cookies)
    this.masterKey = await this.getMasterKey(browserType);

    // Copy to temp location (the browser locks the database while running)
    const tempPath = path.join(
      process.env.TEMP || "",
      `cookies_${Date.now()}.db`,
    );

    try {
      await this.copyLockedFile(cookiePath, tempPath);
    } catch (error: any) {
      throw new Error(
        `无法读取 ${browserType} Cookie 数据库。` +
          `请关闭 ${browserType === "chrome" ? "Chrome" : browserType === "edge" ? "Edge" : "Firefox"} 浏览器后重试。` +
          `\n原始错误: ${error.message}`,
      );
    }

    try {
      const db = new Database(tempPath, { readonly: true });
      const rows = db
        .prepare(
          `
        SELECT name, encrypted_value, host_key, path, expires_utc, is_secure, is_httponly, samesite
        FROM cookies
      `,
        )
        .all() as any[];

      const cookies: CookieData[] = [];

      for (const row of rows) {
        try {
          const value = await this.decryptChromeValue(row.encrypted_value);
          if (!value) continue; // skip cookies that couldn't be decrypted

          cookies.push({
            name: row.name,
            value,
            domain: row.host_key,
            path: row.path,
            expires: row.expires_utc
              ? Math.floor(row.expires_utc / 1000000 - 11644473600)
              : undefined,
            httpOnly: row.is_httponly === 1,
            secure: row.is_secure === 1,
            sameSite:
              row.samesite === 0
                ? "None"
                : row.samesite === 1
                  ? "Lax"
                  : "Strict",
          });
        } catch (error) {
          // Skip cookies that fail to decrypt
          continue;
        }
      }

      db.close();
      return cookies;
    } finally {
      // Clean up temp file
      try {
        fs.unlinkSync(tempPath);
      } catch {}
    }
  }

  /**
   * 复制被浏览器锁定的文件
   *
   * 浏览器运行时会独占 Cookie 数据库，导致普通 copyFileSync 报 EBUSY。
   * 先尝试普通复制，失败后回退到 PowerShell 以 FileShare.ReadWrite 共享读取。
   */
  private async copyLockedFile(src: string, dest: string): Promise<void> {
    try {
      fs.copyFileSync(src, dest);
      return;
    } catch {
      // 数据库被锁定，回退到共享读取模式
    }

    const psScript = [
      `$src = '${src.replace(/'/g, "''")}';`,
      `$dest = '${dest.replace(/'/g, "''")}';`,
      "$fs = [System.IO.File]::Open($src, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite);",
      "$out = [System.IO.File]::Create($dest);",
      "$fs.CopyTo($out);",
      "$out.Close(); $fs.Close();",
    ].join(" ");

    await execAsync(
      `powershell -NoProfile -NonInteractive -Command "${psScript.replace(/"/g, '\\"')}"`,
      { maxBuffer: 10 * 1024 * 1024 },
    );

    if (!fs.existsSync(dest)) {
      throw new Error(`Failed to copy locked cookie database: ${src}`);
    }
  }

  /**
   * 获取浏览器 AES 主密钥
   *
   * Chrome/Edge v80+ 将 AES-256 主密钥存储在 Local State 文件的
   * os_crypt.encrypted_key 字段，使用 Base64 编码 + DPAPI 加密，
   * 且带有 "DPAPI" 前缀（5 字节）。
   */
  private async getMasterKey(
    browserType: "chrome" | "edge" | "firefox",
  ): Promise<Buffer | null> {
    const localStatePaths: Record<string, string> = {
      chrome: path.join(
        process.env.LOCALAPPDATA || "",
        "Google",
        "Chrome",
        "User Data",
        "Local State",
      ),
      edge: path.join(
        process.env.LOCALAPPDATA || "",
        "Microsoft",
        "Edge",
        "User Data",
        "Local State",
      ),
      firefox: "",
    };

    const localStatePath = localStatePaths[browserType];
    if (!localStatePath || !fs.existsSync(localStatePath)) {
      return null;
    }

    try {
      const localState = JSON.parse(fs.readFileSync(localStatePath, "utf-8"));
      const encryptedKeyB64: string | undefined =
        localState?.os_crypt?.encrypted_key;
      if (!encryptedKeyB64) return null;

      // Base64 解码，去掉 "DPAPI" 前缀（5 字节）
      const encryptedKey = Buffer.from(encryptedKeyB64, "base64").subarray(5);

      // 用 DPAPI 解密得到明文 AES 主密钥
      const decrypted = await this.dpapiDecrypt(encryptedKey);
      return decrypted && decrypted.length > 0 ? decrypted : null;
    } catch {
      return null;
    }
  }

  /**
   * 使用 Windows DPAPI 解密 Chrome Cookie 值
   *
   * 支持两种格式：
   * - v10/v11：AES-256-GCM，需要 Local State 中的主密钥
   * - 旧版：直接 DPAPI 加密
   */
  private async decryptChromeValue(encryptedValue: Buffer): Promise<string> {
    if (encryptedValue.length === 0) {
      return "";
    }

    // Chrome v80+ 使用 'v10'/'v11' 前缀 + AES-256-GCM
    const prefix = encryptedValue.subarray(0, 3).toString("utf-8");
    if ((prefix === "v10" || prefix === "v11") && this.masterKey) {
      try {
        // 结构: [3字节前缀][12字节 nonce][密文][16字节 auth tag]
        const nonce = encryptedValue.subarray(3, 15);
        const ciphertext = encryptedValue.subarray(
          15,
          encryptedValue.length - 16,
        );
        const authTag = encryptedValue.subarray(encryptedValue.length - 16);

        const decipher = crypto.createDecipheriv(
          "aes-256-gcm",
          this.masterKey,
          nonce,
        );
        decipher.setAuthTag(authTag);

        const decrypted = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]);
        return decrypted.toString("utf-8");
      } catch {
        return "";
      }
    }

    // 旧版：直接使用 DPAPI 解密
    const decrypted = await this.dpapiDecrypt(encryptedValue);
    return decrypted ? decrypted.toString("utf-8") : "";
  }

  /**
   * 使用 Windows DPAPI 解密二进制数据（通过 PowerShell）
   */
  private async dpapiDecrypt(data: Buffer): Promise<Buffer | null> {
    const bytes = Array.from(data).join(",");
    const psScript = [
      "Add-Type -AssemblyName System.Security;",
      `$bytes = [byte[]]@(${bytes});`,
      "$d = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser);",
      "[Convert]::ToBase64String($d);",
    ].join(" ");

    try {
      const { stdout } = await execAsync(
        `powershell -NoProfile -NonInteractive -Command "${psScript.replace(/"/g, '\\"')}"`,
        { maxBuffer: 10 * 1024 * 1024 },
      );
      const b64 = stdout.trim();
      return b64 ? Buffer.from(b64, "base64") : null;
    } catch {
      return null;
    }
  }

  /**
   * 导出当前浏览器的 Cookie
   */
  async exportCookies(): Promise<CookieData[]> {
    if (!this.context) {
      throw new Error("Browser context not available.");
    }

    const cookies = await this.context.cookies();
    return cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite as "Strict" | "Lax" | "None" | undefined,
    }));
  }

  /**
   * 从文件加载 Cookie
   */
  async loadCookiesFromFile(filePath: string): Promise<void> {
    if (!this.context) {
      throw new Error("Browser context not available. Call launch() first.");
    }

    const cookiesJson = fs.readFileSync(filePath, "utf-8");
    const cookies = JSON.parse(cookiesJson) as CookieData[];
    await this.context.addCookies(cookies);
  }

  /**
   * 保存 Cookie 到文件
   */
  async saveCookiesToFile(filePath: string): Promise<void> {
    const cookies = await this.exportCookies();
    fs.writeFileSync(filePath, JSON.stringify(cookies, null, 2));
  }
}
