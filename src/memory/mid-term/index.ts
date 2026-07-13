export interface MidTermMemoryEntry {
  id: string;
  content: string;
  embedding?: number[];
  metadata: Record<string, any>;
  createdAt: number;
  updatedAt: number;
  accessedCount: number;
  lastAccessedAt: number;
}

export interface SearchOptions {
  query: string;
  limit?: number;
  filters?: Record<string, any>;
  similarityThreshold?: number;
}

export interface SearchResult {
  entry: MidTermMemoryEntry;
  similarity: number;
}

export class MidTermMemory {
  private entries: Map<string, MidTermMemoryEntry> = new Map();
  private nextId = 1;

  add(content: string, metadata: Record<string, any> = {}): MidTermMemoryEntry {
    const entry: MidTermMemoryEntry = {
      id: `mtm_${this.nextId++}`,
      content,
      metadata,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      accessedCount: 0,
      lastAccessedAt: Date.now()
    };
    
    this.entries.set(entry.id, entry);
    
    return entry;
  }

  get(id: string): MidTermMemoryEntry | undefined {
    const entry = this.entries.get(id);
    
    if (entry) {
      entry.accessedCount++;
      entry.lastAccessedAt = Date.now();
      entry.updatedAt = Date.now();
    }
    
    return entry;
  }

  update(id: string, updates: Partial<MidTermMemoryEntry>): boolean {
    const entry = this.entries.get(id);
    
    if (!entry) return false;
    
    Object.assign(entry, updates, { updatedAt: Date.now() });
    
    return true;
  }

  delete(id: string): boolean {
    return this.entries.delete(id);
  }

  search(options: SearchOptions): SearchResult[] {
    const results: SearchResult[] = [];
    const limit = options.limit ?? 10;
    
    for (const entry of this.entries.values()) {
      let similarity = this.calculateSimilarity(entry, options.query);
      
      if (options.filters) {
        for (const [key, value] of Object.entries(options.filters)) {
          if (entry.metadata[key] !== value) {
            similarity = 0;
            break;
          }
        }
      }
      
      if (similarity > (options.similarityThreshold ?? 0.3)) {
        results.push({ entry, similarity });
      }
    }
    
    results.sort((a, b) => b.similarity - a.similarity);
    
    return results.slice(0, limit);
  }

  private calculateSimilarity(entry: MidTermMemoryEntry, query: string): number {
    const content = entry.content.toLowerCase();
    const queryLower = query.toLowerCase();
    
    if (content.includes(queryLower)) {
      return 0.7 + Math.min(0.3, queryLower.length / content.length);
    }
    
    const contentWords = content.split(/\s+/);
    const queryWords = queryLower.split(/\s+/);
    
    let matched = 0;
    for (const word of queryWords) {
      if (contentWords.includes(word)) {
        matched++;
      }
    }
    
    return queryWords.length > 0 ? matched / queryWords.length : 0;
  }

  list(options?: { filters?: Record<string, any> }): MidTermMemoryEntry[] {
    let entries = Array.from(this.entries.values());
    
    if (options?.filters) {
      entries = entries.filter(entry => {
        for (const [key, value] of Object.entries(options.filters)) {
          if (entry.metadata[key] !== value) return false;
        }
        return true;
      });
    }
    
    return entries.sort((a, b) => b.createdAt - a.createdAt);
  }

  getStats(): {
    total: number;
    avgAccessCount: number;
    oldestEntryAgeMs: number;
    newestEntryAgeMs: number;
  } {
    const now = Date.now();
    let totalAccess = 0;
    let oldest = now;
    let newest = 0;
    
    for (const entry of this.entries.values()) {
      totalAccess += entry.accessedCount;
      if (entry.createdAt < oldest) oldest = entry.createdAt;
      if (entry.createdAt > newest) newest = entry.createdAt;
    }
    
    return {
      total: this.entries.size,
      avgAccessCount: this.entries.size > 0 ? totalAccess / this.entries.size : 0,
      oldestEntryAgeMs: now - oldest,
      newestEntryAgeMs: now - newest
    };
  }

  cleanup(maxAgeMs?: number, maxEntries?: number): number {
    const now = Date.now();
    let deleted = 0;
    
    const entriesArray = Array.from(this.entries.values())
      .sort((a, b) => b.accessedCount - a.accessedCount);
    
    if (maxAgeMs) {
      for (const entry of entriesArray) {
        if (now - entry.createdAt > maxAgeMs) {
          this.entries.delete(entry.id);
          deleted++;
        }
      }
    }
    
    if (maxEntries && this.entries.size > maxEntries) {
      const toDelete = this.entries.size - maxEntries;
      const oldest = Array.from(this.entries.values())
        .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)
        .slice(0, toDelete);
      
      for (const entry of oldest) {
        this.entries.delete(entry.id);
        deleted++;
      }
    }
    
    return deleted;
  }
}

export default MidTermMemory;