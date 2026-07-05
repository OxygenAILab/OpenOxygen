#!/usr/bin/env node
/**
 * OxygenMemo Alpha - 分层记忆管理引擎
 * 零模型改动，纯Agent侧实现的虚拟内存系统
 * 核心特性：
 * - 多级树形索引（根索引 → 二级索引 → 记忆页）
 * - TLB快表（热点页常驻）
 * - 生命周期管理（LRU淘汰、垃圾回收）
 * - 指针式关联记忆
 * - 跨页融合
 * - 版本控制与写时复制
 */

import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";

// ===== 核心数据结构 =====

export interface MemoryPage {
  page_id: string;
  label: string; // 语义标签（1-3个关键词）
  content: string; // 页面内容
  category: string; // 所属分类
  created_at: number; // timestamp
  last_accessed: number; // timestamp
  access_count: number;
  version: number;
  pointers: Record<string, string>; // {标签: 目标页ID}
  is_deleted: boolean;
}

export interface IndexEntry {
  page_id: string;
  label: string;
  summary: string; // 一句话摘要
  category: string;
}

// ===== TLB 快表（LRU缓存） =====

export class TLB {
  private max_size: number;
  private cache: Map<string, MemoryPage>; // 使用Map维护插入顺序（LRU）

  constructor(max_size: number = 5) {
    this.max_size = max_size;
    this.cache = new Map();
  }

  /**
   * 获取页，命中则移到末尾（最新）
   */
  get(page_id: string): MemoryPage | null {
    if (this.cache.has(page_id)) {
      const page = this.cache.get(page_id)!;
      // 移到末尾（删除再添加）
      this.cache.delete(page_id);
      this.cache.set(page_id, page);
      return page;
    }
    return null;
  }

  /**
   * 放入页，超出则淘汰最旧的
   */
  put(page: MemoryPage): void {
    if (this.cache.has(page.page_id)) {
      // 已存在，更新内容并移到末尾
      this.cache.delete(page.page_id);
      this.cache.set(page.page_id, page);
    } else {
      // 新页，检查是否超出容量
      if (this.cache.size >= this.max_size) {
        // 淘汰最旧的（第一个）
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }
      this.cache.set(page.page_id, page);
    }
  }

  /**
   * 失效指定页
   */
  invalidate(page_id: string): void {
    this.cache.delete(page_id);
  }

  /**
   * 获取所有热点页
   */
  getHotPages(): MemoryPage[] {
    return Array.from(this.cache.values());
  }

  /**
   * 清空快表
   */
  clear(): void {
    this.cache.clear();
  }
}

// ===== OxygenMemo 核心记忆管理器 =====

export class OxygenMemo {
  // 根分类定义
  static readonly ROOT_CATEGORIES: Record<string, string> = {
    core: "核心背景",
    task: "任务进度",
    knowledge: "知识沉淀",
    history: "交互历史",
    misc: "其他内容",
  };

  private storage_path: string;
  private pages_path: string;
  private index_path: string;
  private meta_path: string;
  private tlb: TLB;
  private pages: Map<string, MemoryPage>;
  private secondary_indexes: Map<string, IndexEntry[]>;
  private stats: {
    total_pages: number;
    total_reads: number;
    total_writes: number;
    tlb_hits: number;
    tlb_misses: number;
  };

  constructor(storage_path: string = "./memory_store", tlb_size: number = 5) {
    this.storage_path = storage_path;
    this.pages_path = path.join(storage_path, "pages");
    this.index_path = path.join(storage_path, "index.json");
    this.meta_path = path.join(storage_path, "meta.json");
    this.tlb = new TLB(tlb_size);
    this.pages = new Map();
    this.secondary_indexes = new Map();
    this.stats = {
      total_pages: 0,
      total_reads: 0,
      total_writes: 0,
      tlb_hits: 0,
      tlb_misses: 0,
    };

    // 同步初始化存储和加载数据
    this._initStorage();
    this._loadAll();
  }

  /**
   * 初始化（异步）
   */
  async initialize(): Promise<void> {
    await this._initStorage();
    await this._loadAll();
  }

  /**
   * 初始化存储目录
   */
  private _initStorage(): void {
    fsSync.mkdirSync(this.pages_path, { recursive: true });

    if (!fsSync.existsSync(this.index_path)) {
      this._saveIndexSync();
    }

    if (!fsSync.existsSync(this.meta_path)) {
      this._saveMetaSync();
    }
  }

  /**
   * 生成页ID：分类前缀+3位序号
   */
  private _generatePageId(category: string): string {
    const prefix_map: Record<string, string> = {
      core: "C",
      task: "T",
      knowledge: "K",
      history: "H",
      misc: "M",
    };
    const prefix = prefix_map[category] || "X";

    // 统计当前分类的页数
    const existing = Array.from(this.pages.values()).filter(
      (p) => p.category === category,
    );
    const num = existing.length + 1;

    return `${prefix}${num.toString().padStart(3, "0")}`;
  }

  /**
   * 生成内容摘要
   */
  private _generateSummary(content: string, max_len: number = 80): string {
    content = content.trim();
    if (content.length <= max_len) {
      return content;
    }
    return content.substring(0, max_len) + "...";
  }

  // ===== 核心读写操作 =====

  /**
   * 写入记忆页
   * - 若page_id存在则覆盖（版本+1，写时复制）
   * - 若不存在则新建
   * 返回页ID
   */
  async writePage(
    content: string,
    label: string,
    category: string,
    page_id?: string,
  ): Promise<string> {
    if (!OxygenMemo.ROOT_CATEGORIES[category]) {
      category = "misc";
    }

    let page: MemoryPage;

    if (page_id && this.pages.has(page_id)) {
      // 覆盖写入 - 写时复制
      const old_page = this.pages.get(page_id)!;
      page = {
        page_id,
        label,
        content,
        category,
        created_at: old_page.created_at,
        last_accessed: Date.now(),
        access_count: old_page.access_count + 1,
        version: old_page.version + 1,
        pointers: { ...old_page.pointers },
        is_deleted: false,
      };
    } else {
      // 新建页
      page_id = this._generatePageId(category);
      page = {
        page_id,
        label,
        content,
        category,
        created_at: Date.now(),
        last_accessed: Date.now(),
        access_count: 0,
        version: 1,
        pointers: {},
        is_deleted: false,
      };
      this.stats.total_pages += 1;
    }

    this.pages.set(page_id, page);
    await this._savePage(page);
    await this._updateIndex(page);
    this.tlb.put(page);
    this.stats.total_writes += 1;
    await this._saveMeta();

    return page_id;
  }

  /**
   * 追加内容到指定页
   */
  async appendPage(page_id: string, content: string): Promise<boolean> {
    const page = this._getPageInternal(page_id);
    if (!page) {
      return false;
    }

    const new_content = page.content + "\n" + content;
    const result = await this.writePage(
      new_content,
      page.label,
      page.category,
      page_id,
    );
    return result === page_id;
  }

  /**
   * 加载记忆页
   * 返回页的完整信息
   */
  async loadPage(page_id: string): Promise<MemoryPage | null> {
    this.stats.total_reads += 1;

    // 先查TLB
    const tlb_page = this.tlb.get(page_id);
    if (tlb_page && !tlb_page.is_deleted) {
      this.stats.tlb_hits += 1;
      tlb_page.last_accessed = Date.now();
      tlb_page.access_count += 1;
      return tlb_page;
    }

    this.stats.tlb_misses += 1;

    // 从存储加载
    if (this.pages.has(page_id)) {
      const page = this.pages.get(page_id)!;
      if (!page.is_deleted) {
        page.last_accessed = Date.now();
        page.access_count += 1;
        this.tlb.put(page);
        await this._savePage(page);
        return page;
      }
    }

    return null;
  }

  /**
   * 内部获取页对象（不计入统计）
   */
  private _getPageInternal(page_id: string): MemoryPage | null {
    if (this.pages.has(page_id)) {
      const page = this.pages.get(page_id)!;
      if (!page.is_deleted) {
        return page;
      }
    }
    return null;
  }

  /**
   * 软删除记忆页
   */
  async deletePage(page_id: string): Promise<boolean> {
    const page = this._getPageInternal(page_id);
    if (!page) {
      return false;
    }

    page.is_deleted = true;
    this.tlb.invalidate(page_id);
    await this._savePage(page);
    await this._rebuildIndex();
    return true;
  }

  // ===== 索引操作 =====

  /**
   * 获取根索引（主上下文常驻）
   */
  getRootIndex(): Record<
    string,
    { name: string; page_count: number; index_id: string }
  > {
    const result: Record<
      string,
      { name: string; page_count: number; index_id: string }
    > = {};

    for (const [cat_key, cat_name] of Object.entries(
      OxygenMemo.ROOT_CATEGORIES,
    )) {
      const entries = this.secondary_indexes.get(cat_key) || [];
      result[cat_key] = {
        name: cat_name,
        page_count: entries.length,
        index_id: `IDX_${cat_key.toUpperCase()}`,
      };
    }

    return result;
  }

  /**
   * 获取二级索引页
   */
  getSecondaryIndex(category: string): IndexEntry[] {
    return this.secondary_indexes.get(category) || [];
  }

  /**
   * 更新索引
   */
  private async _updateIndex(page: MemoryPage): Promise<void> {
    if (page.is_deleted) {
      await this._rebuildIndex();
      return;
    }

    const entry: IndexEntry = {
      page_id: page.page_id,
      label: page.label,
      summary: this._generateSummary(page.content),
      category: page.category,
    };

    if (!this.secondary_indexes.has(page.category)) {
      this.secondary_indexes.set(page.category, []);
    }

    const entries = this.secondary_indexes.get(page.category)!;
    const index = entries.findIndex((e) => e.page_id === page.page_id);

    if (index >= 0) {
      entries[index] = entry;
    } else {
      entries.push(entry);
    }

    await this._saveIndex();
  }

  /**
   * 重建所有索引
   */
  private async _rebuildIndex(): Promise<void> {
    this.secondary_indexes.clear();

    for (const page of Array.from(this.pages.values())) {
      if (!page.is_deleted) {
        await this._updateIndex(page);
      }
    }

    await this._saveIndex();
  }

  // ===== 指针关联 =====

  /**
   * 创建页间指针
   */
  async createPointer(
    from_id: string,
    to_id: string,
    label: string,
  ): Promise<boolean> {
    const from_page = this._getPageInternal(from_id);
    const to_page = this._getPageInternal(to_id);

    if (!from_page || !to_page) {
      return false;
    }

    from_page.pointers[label] = to_id;
    await this._savePage(from_page);
    this.tlb.invalidate(from_id);
    return true;
  }

  /**
   * 获取页的所有指针
   */
  getPointers(page_id: string): Record<string, string> {
    const page = this._getPageInternal(page_id);
    if (!page) {
      return {};
    }
    return { ...page.pointers };
  }

  // ===== 跨页融合 =====

  /**
   * 合并多个记忆页，生成精简融合摘要
   * 返回新页ID
   */
  async mergePages(
    page_ids: string[],
    output_label: string = "融合摘要",
  ): Promise<string> {
    const contents: string[] = [];

    for (const pid of page_ids) {
      const page = this._getPageInternal(pid);
      if (page) {
        contents.push(`【${page.label}】\n${page.content}`);
      }
    }

    if (contents.length === 0) {
      return "";
    }

    const merged_content = contents.join("\n\n");
    const summary = `本页融合了 ${contents.length} 个记忆页的内容：\n\n${merged_content}`;

    return await this.writePage(summary, output_label, "knowledge");
  }

  // ===== 生命周期管理 =====

  /**
   * 垃圾回收：清理过期且低访问的记忆
   * 返回清理统计
   */
  async collectGarbage(
    max_age_days: number = 30,
    min_access: number = 1,
  ): Promise<{ deleted_pages: number; total_pages: number }> {
    const now = Date.now();
    const max_age = max_age_days * 86400 * 1000; // 转换为毫秒
    let deleted = 0;

    // 标记过期且访问少的页
    for (const page of Array.from(this.pages.values())) {
      if (page.is_deleted) {
        continue;
      }

      const age = now - page.last_accessed;
      if (age > max_age && page.access_count <= min_access) {
        page.is_deleted = true;
        deleted += 1;
      }
    }

    await this._rebuildIndex();
    await this._saveMeta();

    return {
      deleted_pages: deleted,
      total_pages: this.stats.total_pages,
    };
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    total_pages: number;
    total_reads: number;
    total_writes: number;
    tlb_hits: number;
    tlb_misses: number;
    tlb_hit_rate: string;
    hot_pages: number;
    categories: Record<string, number>;
  } {
    const tlb_total = this.stats.tlb_hits + this.stats.tlb_misses;
    const tlb_hit_rate =
      tlb_total > 0
        ? ((this.stats.tlb_hits / tlb_total) * 100).toFixed(1)
        : "0.0";

    const categories: Record<string, number> = {};
    for (const [cat, entries] of Array.from(this.secondary_indexes.entries())) {
      categories[cat] = entries.length;
    }

    return {
      ...this.stats,
      tlb_hit_rate: `${tlb_hit_rate}%`,
      hot_pages: this.tlb.getHotPages().length,
      categories,
    };
  }

  // ===== 进阶特性：语义预取 =====

  /**
   * 语义预取：基于当前页预测下一个可能需要的页
   * 策略：
   * 1. 优先返回当前页的指针指向的页（100分）
   * 2. 反向指针（指向当前页的页）（80分）
   * 3. 同分类高访问页（60分）
   * 4. 最近访问的页（40分）
   * 返回 Top K 个页ID
   */
  prefetchPages(current_page_id: string, top_k: number = 3): string[] {
    const scores: Map<string, number> = new Map();
    const current_page = this._getPageInternal(current_page_id);

    if (current_page) {
      // 1. 指针关联的页（最高优先级）
      for (const [label, target_id] of Object.entries(current_page.pointers)) {
        if (!scores.has(target_id)) {
          scores.set(target_id, 100);
        }
      }

      // 2. 反向指针：哪些页指向当前页
      for (const page of Array.from(this.pages.values())) {
        if (page.is_deleted) continue;

        for (const [label, target_id] of Object.entries(page.pointers)) {
          if (target_id === current_page_id && !scores.has(page.page_id)) {
            scores.set(page.page_id, 80);
          }
        }
      }

      // 3. 同分类高访问页
      const same_category = Array.from(this.pages.values())
        .filter(
          (p) =>
            !p.is_deleted &&
            p.category === current_page.category &&
            p.page_id !== current_page_id,
        )
        .sort((a, b) => b.access_count - a.access_count)
        .slice(0, 5);

      for (const page of same_category) {
        if (!scores.has(page.page_id)) {
          scores.set(page.page_id, 60);
        }
      }

      // 4. 最近访问的页
      const recent_pages = Array.from(this.pages.values())
        .filter((p) => !p.is_deleted && p.page_id !== current_page_id)
        .sort((a, b) => b.last_accessed - a.last_accessed)
        .slice(0, 5);

      for (const page of recent_pages) {
        if (!scores.has(page.page_id)) {
          scores.set(page.page_id, 40);
        }
      }
    }

    // 按分数排序，返回 Top K
    const sorted = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, top_k)
      .map(([page_id]) => page_id);

    return sorted;
  }

  // ===== 持久化 =====

  /**
   * 保存单页到磁盘
   */
  private async _savePage(page: MemoryPage): Promise<void> {
    const file_path = path.join(this.pages_path, `${page.page_id}.json`);
    await fs.writeFile(file_path, JSON.stringify(page, null, 2), "utf-8");
  }

  /**
   * 保存单页到磁盘（同步版本）
   */
  private _savePageSync(page: MemoryPage): void {
    const file_path = path.join(this.pages_path, `${page.page_id}.json`);
    fsSync.writeFileSync(file_path, JSON.stringify(page, null, 2), "utf-8");
  }

  /**
   * 从磁盘加载单页
   */
  private async _loadPage(page_id: string): Promise<MemoryPage | null> {
    const file_path = path.join(this.pages_path, `${page_id}.json`);

    try {
      const data = await fs.readFile(file_path, "utf-8");
      return JSON.parse(data) as MemoryPage;
    } catch {
      return null;
    }
  }

  /**
   * 保存索引
   */
  private async _saveIndex(): Promise<void> {
    const data: Record<string, IndexEntry[]> = {};

    for (const [cat, entries] of Array.from(this.secondary_indexes.entries())) {
      data[cat] = entries;
    }

    await fs.writeFile(this.index_path, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * 保存索引（同步版本）
   */
  private _saveIndexSync(): void {
    const data: Record<string, IndexEntry[]> = {};

    for (const [cat, entries] of Array.from(this.secondary_indexes.entries())) {
      data[cat] = entries;
    }

    fsSync.writeFileSync(
      this.index_path,
      JSON.stringify(data, null, 2),
      "utf-8",
    );
  }

  /**
   * 加载索引
   */
  private async _loadIndex(): Promise<void> {
    try {
      const data = await fs.readFile(this.index_path, "utf-8");
      const parsed = JSON.parse(data) as Record<string, IndexEntry[]>;

      this.secondary_indexes.clear();
      for (const [cat, entries] of Object.entries(parsed)) {
        this.secondary_indexes.set(cat, entries);
      }
    } catch {
      // 文件不存在或解析失败，保持空索引
    }
  }

  /**
   * 加载索引（同步版本）
   */
  private _loadIndexSync(): void {
    try {
      const data = fsSync.readFileSync(this.index_path, "utf-8");
      const parsed = JSON.parse(data) as Record<string, IndexEntry[]>;

      this.secondary_indexes.clear();
      for (const [cat, entries] of Object.entries(parsed)) {
        this.secondary_indexes.set(cat, entries);
      }
    } catch {
      // 文件不存在或解析失败，保持空索引
    }
  }

  /**
   * 保存元数据
   */
  private async _saveMeta(): Promise<void> {
    await fs.writeFile(
      this.meta_path,
      JSON.stringify(this.stats, null, 2),
      "utf-8",
    );
  }

  /**
   * 保存元数据（同步版本）
   */
  private _saveMetaSync(): void {
    fsSync.writeFileSync(
      this.meta_path,
      JSON.stringify(this.stats, null, 2),
      "utf-8",
    );
  }

  /**
   * 加载元数据
   */
  private async _loadMeta(): Promise<void> {
    try {
      const data = await fs.readFile(this.meta_path, "utf-8");
      this.stats = JSON.parse(data);
    } catch {
      // 文件不存在或解析失败，保持默认统计
    }
  }

  /**
   * 加载元数据（同步版本）
   */
  private _loadMetaSync(): void {
    try {
      const data = fsSync.readFileSync(this.meta_path, "utf-8");
      this.stats = JSON.parse(data);
    } catch {
      // 文件不存在或解析失败，保持默认统计
    }
  }

  /**
   * 加载所有数据
   */
  private _loadAll(): void {
    this._loadIndexSync();
    this._loadMetaSync();

    // 加载所有页
    try {
      const files = fsSync.readdirSync(this.pages_path);

      for (const fname of files) {
        if (fname.endsWith(".json")) {
          const page_id = fname.slice(0, -5);
          const page = this._loadPageSync(page_id);
          if (page) {
            this.pages.set(page_id, page);
          }
        }
      }
    } catch {
      // 目录不存在或读取失败
    }
  }

  /**
   * 从磁盘加载单页（同步版本）
   */
  private _loadPageSync(page_id: string): MemoryPage | null {
    const filepath = path.join(this.pages_path, `${page_id}.json`);
    if (!fsSync.existsSync(filepath)) {
      return null;
    }
    try {
      const data = fsSync.readFileSync(filepath, "utf-8");
      return JSON.parse(data) as MemoryPage;
    } catch {
      return null;
    }
  }
}
