export interface BrowserSession {
  id: string;
  pages: Page[];
  isHeadless: boolean;
}

export interface Page {
  id: string;
  url: string;
  title: string;
}

export interface ElementSelector {
  type: 'css' | 'xpath' | 'text' | 'id';
  value: string;
}

export interface BrowserOptions {
  headless?: boolean;
  width?: number;
  height?: number;
}

export interface BrowserResult {
  success: boolean;
  output?: any;
  error?: string;
}

export class BrowserController {
  private sessions: Map<string, BrowserSession> = new Map();
  private nextId = 1;

  async launch(options: BrowserOptions = {}): Promise<BrowserResult> {
    const sessionId = `browser_${this.nextId++}`;
    
    const session: BrowserSession = {
      id: sessionId,
      pages: [],
      isHeadless: options.headless ?? false
    };
    
    this.sessions.set(sessionId, session);
    
    return { success: true, output: { browserId: sessionId, ...options } };
  }

  async close(browserId: string): Promise<BrowserResult> {
    if (!this.sessions.has(browserId)) {
      return { success: false, error: `Browser session not found: ${browserId}` };
    }
    
    this.sessions.delete(browserId);
    
    return { success: true, output: { browserId } };
  }

  async createPage(browserId: string): Promise<BrowserResult> {
    const session = this.sessions.get(browserId);
    if (!session) {
      return { success: false, error: `Browser session not found: ${browserId}` };
    }
    
    const pageId = `page_${this.nextId++}`;
    const page: Page = {
      id: pageId,
      url: '',
      title: ''
    };
    
    session.pages.push(page);
    
    return { success: true, output: { browserId, pageId } };
  }

  async closePage(browserId: string, pageId: string): Promise<BrowserResult> {
    const session = this.sessions.get(browserId);
    if (!session) {
      return { success: false, error: `Browser session not found: ${browserId}` };
    }
    
    const index = session.pages.findIndex(p => p.id === pageId);
    if (index === -1) {
      return { success: false, error: `Page not found: ${pageId}` };
    }
    
    session.pages.splice(index, 1);
    
    return { success: true, output: { browserId, pageId } };
  }

  async navigateTo(browserId: string, pageId: string, url: string): Promise<BrowserResult> {
    const session = this.sessions.get(browserId);
    if (!session) {
      return { success: false, error: `Browser session not found: ${browserId}` };
    }
    
    const page = session.pages.find(p => p.id === pageId);
    if (!page) {
      return { success: false, error: `Page not found: ${pageId}` };
    }
    
    page.url = url;
    
    return { success: true, output: { browserId, pageId, url } };
  }

  async getPageContent(browserId: string, pageId: string): Promise<BrowserResult> {
    const session = this.sessions.get(browserId);
    if (!session) {
      return { success: false, error: `Browser session not found: ${browserId}` };
    }
    
    const page = session.pages.find(p => p.id === pageId);
    if (!page) {
      return { success: false, error: `Page not found: ${pageId}` };
    }
    
    return { success: true, output: { browserId, pageId, url: page.url, title: page.title, content: '' } };
  }

  async clickElement(browserId: string, pageId: string, selector: ElementSelector): Promise<BrowserResult> {
    return { success: true, output: { browserId, pageId, selector } };
  }

  async typeText(browserId: string, pageId: string, selector: ElementSelector, text: string): Promise<BrowserResult> {
    return { success: true, output: { browserId, pageId, selector, text } };
  }

  async takeScreenshot(browserId: string, pageId: string, fullPage: boolean = false): Promise<BrowserResult> {
    return { success: true, output: { browserId, pageId, fullPage, screenshot: '' } };
  }

  async executeJavaScript(browserId: string, pageId: string, script: string): Promise<BrowserResult> {
    return { success: true, output: { browserId, pageId, script, result: null } };
  }

  async listSessions(): Promise<BrowserResult> {
    const sessions = Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      pageCount: s.pages.length,
      isHeadless: s.isHeadless
    }));
    
    return { success: true, output: { sessions } };
  }

  async getSession(browserId: string): Promise<BrowserResult> {
    const session = this.sessions.get(browserId);
    if (!session) {
      return { success: false, error: `Browser session not found: ${browserId}` };
    }
    
    return { success: true, output: { ...session } };
  }
}

export default BrowserController;