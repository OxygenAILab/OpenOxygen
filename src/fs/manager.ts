import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as crypto from "crypto";
import fg from "fast-glob";
import chokidar from "chokidar";
import archiver from "archiver";
import unzipper from "unzipper";

export interface FileSearchOptions {
  pattern?: string; // glob 模式，如 "**/*.ts"
  content?: string; // 内容搜索（正则）
  minSize?: number; // 最小文件大小（字节）
  maxSize?: number;
  modifiedAfter?: Date;
  modifiedBefore?: Date;
  depth?: number; // 搜索深度
  excludeDirs?: string[]; // 排除目录，如 ["node_modules", ".git"]
  caseSensitive?: boolean;
}

export interface FileInfo {
  path: string;
  name: string;
  size: number;
  created: Date;
  modified: Date;
  isDirectory: boolean;
  extension?: string;
}

export interface BatchOperation {
  type: "copy" | "move" | "delete" | "rename";
  files: string[];
  destination?: string; // for copy/move
  pattern?: string; // for rename
}

export interface WatchOptions {
  recursive?: boolean;
  events?: Array<"add" | "change" | "unlink">;
  filter?: (path: string) => boolean;
}

export interface BatchResult {
  success: number;
  failed: string[];
}

export interface ContentMatch {
  file: string;
  line: number;
  content: string;
}

export class FileSystemManager {
  private readonly defaultExcludes = [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "coverage",
  ];

  /**
   * 搜索文件
   */
  async search(
    basePath: string,
    options: FileSearchOptions,
  ): Promise<FileInfo[]> {
    const {
      pattern = "**/*",
      minSize,
      maxSize,
      modifiedAfter,
      modifiedBefore,
      depth,
      excludeDirs = this.defaultExcludes,
      caseSensitive = false,
    } = options;

    // 构建 glob 选项
    const globOptions: fg.Options = {
      cwd: basePath,
      absolute: true,
      stats: true,
      caseSensitiveMatch: caseSensitive,
      ignore: excludeDirs.map((dir) => `**/${dir}/**`),
    };

    if (depth !== undefined) {
      globOptions.deep = depth;
    }

    // 执行 glob 搜索
    const entries = await fg(pattern, globOptions);
    const results: FileInfo[] = [];

    for (const entry of entries) {
      try {
        const stats = await fs.stat(entry as string);

        // 应用过滤条件
        if (minSize !== undefined && stats.size < minSize) continue;
        if (maxSize !== undefined && stats.size > maxSize) continue;
        if (modifiedAfter && stats.mtime < modifiedAfter) continue;
        if (modifiedBefore && stats.mtime > modifiedBefore) continue;

        const filePath = entry as string;
        const fileName = path.basename(filePath);
        const ext = path.extname(filePath);

        results.push({
          path: filePath,
          name: fileName,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          isDirectory: stats.isDirectory(),
          extension: ext ? ext.slice(1) : undefined,
        });
      } catch (error) {
        // 跳过无法访问的文件
        continue;
      }
    }

    return results;
  }

  /**
   * 搜索文件内容
   */
  async searchContent(
    basePath: string,
    regex: string | RegExp,
  ): Promise<ContentMatch[]> {
    const pattern = typeof regex === "string" ? new RegExp(regex) : regex;
    const files = await this.search(basePath, { pattern: "**/*" });
    const results: ContentMatch[] = [];

    for (const file of files) {
      if (file.isDirectory) continue;

      try {
        // 逐行读取避免大文件 OOM
        const content = await fs.readFile(file.path, "utf-8");
        const lines = content.split("\n");

        lines.forEach((line, index) => {
          if (pattern.test(line)) {
            results.push({
              file: file.path,
              line: index + 1,
              content: line.trim(),
            });
          }
        });
      } catch (error) {
        // 跳过二进制文件或无法读取的文件
        continue;
      }
    }

    return results;
  }

  /**
   * 批量复制文件
   */
  async batchCopy(files: string[], destination: string): Promise<BatchResult> {
    const result: BatchResult = { success: 0, failed: [] };

    // 确保目标目录存在
    await this.createDirectory(destination, true);

    for (const file of files) {
      try {
        const fileName = path.basename(file);
        const destPath = path.join(destination, fileName);
        await this.copyFile(file, destPath);
        result.success++;
      } catch (error) {
        result.failed.push(file);
      }
    }

    return result;
  }

  /**
   * 批量移动文件
   */
  async batchMove(files: string[], destination: string): Promise<BatchResult> {
    const result: BatchResult = { success: 0, failed: [] };

    // 确保目标目录存在
    await this.createDirectory(destination, true);

    for (const file of files) {
      try {
        const fileName = path.basename(file);
        const destPath = path.join(destination, fileName);
        await this.moveFile(file, destPath);
        result.success++;
      } catch (error) {
        result.failed.push(file);
      }
    }

    return result;
  }

  /**
   * 批量删除文件
   */
  async batchDelete(files: string[]): Promise<BatchResult> {
    const result: BatchResult = { success: 0, failed: [] };

    for (const file of files) {
      try {
        const stats = await fs.stat(file);
        if (stats.isDirectory()) {
          await this.deleteDirectory(file, true);
        } else {
          await this.deleteFile(file);
        }
        result.success++;
      } catch (error) {
        result.failed.push(file);
      }
    }

    return result;
  }

  /**
   * 批量重命名文件
   * pattern 格式: "prefix_${name}_suffix" 或 "${name}.new${ext}"
   */
  async batchRename(files: string[], pattern: string): Promise<BatchResult> {
    const result: BatchResult = { success: 0, failed: [] };

    for (const file of files) {
      try {
        const dir = path.dirname(file);
        const name = path.basename(file, path.extname(file));
        const ext = path.extname(file);

        // 替换模板变量
        const newName = pattern.replace("${name}", name).replace("${ext}", ext);

        const newPath = path.join(dir, newName);
        await fs.rename(file, newPath);
        result.success++;
      } catch (error) {
        result.failed.push(file);
      }
    }

    return result;
  }

  /**
   * 读取文件
   */
  async readFile(
    filePath: string,
    encoding?: BufferEncoding,
  ): Promise<string | Buffer> {
    if (encoding) {
      return await fs.readFile(filePath, encoding);
    }
    return await fs.readFile(filePath);
  }

  /**
   * 写入文件
   */
  async writeFile(filePath: string, content: string | Buffer): Promise<void> {
    const dir = path.dirname(filePath);
    await this.createDirectory(dir, true);
    await fs.writeFile(filePath, content);
  }

  /**
   * 追加内容到文件
   */
  async appendFile(filePath: string, content: string): Promise<void> {
    await fs.appendFile(filePath, content);
  }

  /**
   * 删除文件
   */
  async deleteFile(filePath: string): Promise<void> {
    await fs.unlink(filePath);
  }

  /**
   * 复制文件
   */
  async copyFile(src: string, dest: string): Promise<void> {
    const destDir = path.dirname(dest);
    await this.createDirectory(destDir, true);
    await fs.copyFile(src, dest);
  }

  /**
   * 移动文件
   */
  async moveFile(src: string, dest: string): Promise<void> {
    const destDir = path.dirname(dest);
    await this.createDirectory(destDir, true);
    await fs.rename(src, dest);
  }

  /**
   * 检查文件/目录是否存在
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取文件信息
   */
  async stat(filePath: string): Promise<FileInfo> {
    const stats = await fs.stat(filePath);
    const name = path.basename(filePath);
    const ext = path.extname(filePath);

    return {
      path: filePath,
      name,
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      isDirectory: stats.isDirectory(),
      extension: ext ? ext.slice(1) : undefined,
    };
  }

  /**
   * 列出目录内容
   */
  async listDirectory(dirPath: string, recursive = false): Promise<FileInfo[]> {
    const results: FileInfo[] = [];

    const processDir = async (currentPath: string) => {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        const stats = await fs.stat(fullPath);
        const ext = path.extname(entry.name);

        results.push({
          path: fullPath,
          name: entry.name,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          isDirectory: entry.isDirectory(),
          extension: ext ? ext.slice(1) : undefined,
        });

        if (recursive && entry.isDirectory()) {
          await processDir(fullPath);
        }
      }
    };

    await processDir(dirPath);
    return results;
  }

  /**
   * 创建目录
   */
  async createDirectory(dirPath: string, recursive = false): Promise<void> {
    await fs.mkdir(dirPath, { recursive });
  }

  /**
   * 删除目录
   */
  async deleteDirectory(dirPath: string, recursive = false): Promise<void> {
    await fs.rm(dirPath, { recursive, force: true });
  }

  /**
   * 监控文件变化
   */
  watch(
    watchPath: string,
    options: WatchOptions,
    callback: (event: string, filePath: string) => void,
  ): { stop: () => void } {
    const {
      recursive = true,
      events = ["add", "change", "unlink"],
      filter,
    } = options;

    const watcher = chokidar.watch(watchPath, {
      persistent: true,
      ignoreInitial: true,
      depth: recursive ? undefined : 0,
      ignored: this.defaultExcludes.map((dir) => `**/${dir}/**`),
    });

    // 注册事件监听器
    if (events.includes("add")) {
      watcher.on("add", (filePath) => {
        if (!filter || filter(filePath)) {
          callback("add", filePath);
        }
      });
    }

    if (events.includes("change")) {
      watcher.on("change", (filePath) => {
        if (!filter || filter(filePath)) {
          callback("change", filePath);
        }
      });
    }

    if (events.includes("unlink")) {
      watcher.on("unlink", (filePath) => {
        if (!filter || filter(filePath)) {
          callback("unlink", filePath);
        }
      });
    }

    return {
      stop: () => {
        watcher.close();
      },
    };
  }

  /**
   * 获取目录大小
   */
  async getDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0;

    const calculateSize = async (currentPath: string) => {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          await calculateSize(fullPath);
        } else {
          const stats = await fs.stat(fullPath);
          totalSize += stats.size;
        }
      }
    };

    await calculateSize(dirPath);
    return totalSize;
  }

  /**
   * 查找重复文件（基于 MD5 哈希）
   */
  async findDuplicates(basePath: string): Promise<Map<string, string[]>> {
    const files = await this.search(basePath, { pattern: "**/*" });
    const hashMap = new Map<string, string[]>();

    for (const file of files) {
      if (file.isDirectory) continue;

      try {
        const hash = await this.calculateFileHash(file.path);
        const existing = hashMap.get(hash) || [];
        existing.push(file.path);
        hashMap.set(hash, existing);
      } catch (error) {
        // 跳过无法读取的文件
        continue;
      }
    }

    // 只返回有重复的文件
    const duplicates = new Map<string, string[]>();
    for (const [hash, paths] of hashMap.entries()) {
      if (paths.length > 1) {
        duplicates.set(hash, paths);
      }
    }

    return duplicates;
  }

  /**
   * 计算文件 MD5 哈希
   */
  private async calculateFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("md5");
      const stream = fsSync.createReadStream(filePath);

      stream.on("data", (data) => hash.update(data));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }

  /**
   * 压缩目录为 ZIP
   */
  async compressDirectory(src: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = fsSync.createWriteStream(dest);
      const archive = (archiver as any)("zip", { zlib: { level: 9 } });

      output.on("close", () => resolve());
      archive.on("error", (err) => reject(err));

      archive.pipe(output);
      archive.directory(src, false);
      archive.finalize();
    });
  }

  /**
   * 解压 ZIP 文件
   */
  async decompressArchive(src: string, dest: string): Promise<void> {
    await this.createDirectory(dest, true);

    return new Promise((resolve, reject) => {
      fsSync
        .createReadStream(src)
        .pipe(unzipper.Extract({ path: dest }))
        .on("close", () => resolve())
        .on("error", (err) => reject(err));
    });
  }
}
