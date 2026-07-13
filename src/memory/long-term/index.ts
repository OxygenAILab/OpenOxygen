export interface LongTermMemoryEntry {
  id: string;
  type: 'fact' | 'rule' | 'experience' | 'preference' | 'knowledge';
  content: string;
  metadata: Record<string, any>;
  createdAt: number;
  updatedAt: number;
  verified: boolean;
  source?: string;
  confidence: number;
}

export interface KnowledgeGraphNode {
  id: string;
  type: string;
  label: string;
  properties: Record<string, any>;
}

export interface KnowledgeGraphEdge {
  source: string;
  target: string;
  relationship: string;
  properties?: Record<string, any>;
}

export class LongTermMemory {
  private entries: Map<string, LongTermMemoryEntry> = new Map();
  private nodes: Map<string, KnowledgeGraphNode> = new Map();
  private edges: Map<string, KnowledgeGraphEdge> = new Map();
  private nextId = 1;

  addEntry(
    type: LongTermMemoryEntry['type'],
    content: string,
    metadata: Record<string, any> = {},
    source?: string
  ): LongTermMemoryEntry {
    const entry: LongTermMemoryEntry = {
      id: `ltm_${this.nextId++}`,
      type,
      content,
      metadata,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      verified: false,
      source,
      confidence: 0.5
    };
    
    this.entries.set(entry.id, entry);
    
    return entry;
  }

  getEntry(id: string): LongTermMemoryEntry | undefined {
    return this.entries.get(id);
  }

  updateEntry(id: string, updates: Partial<LongTermMemoryEntry>): boolean {
    const entry = this.entries.get(id);
    
    if (!entry) return false;
    
    Object.assign(entry, updates, { updatedAt: Date.now() });
    
    return true;
  }

  deleteEntry(id: string): boolean {
    return this.entries.delete(id);
  }

  searchByType(type: LongTermMemoryEntry['type']): LongTermMemoryEntry[] {
    return Array.from(this.entries.values())
      .filter(entry => entry.type === type)
      .sort((a, b) => b.confidence - a.confidence);
  }

  searchByContent(query: string, limit: number = 10): LongTermMemoryEntry[] {
    const queryLower = query.toLowerCase();
    
    return Array.from(this.entries.values())
      .filter(entry => entry.content.toLowerCase().includes(queryLower))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  verifyEntry(id: string, verified: boolean, confidence?: number): boolean {
    const entry = this.entries.get(id);
    
    if (!entry) return false;
    
    entry.verified = verified;
    if (confidence !== undefined) {
      entry.confidence = confidence;
    }
    entry.updatedAt = Date.now();
    
    return true;
  }

  addNode(type: string, label: string, properties: Record<string, any> = {}): KnowledgeGraphNode {
    const node: KnowledgeGraphNode = {
      id: `node_${this.nextId++}`,
      type,
      label,
      properties
    };
    
    this.nodes.set(node.id, node);
    
    return node;
  }

  getNode(id: string): KnowledgeGraphNode | undefined {
    return this.nodes.get(id);
  }

  addEdge(sourceId: string, targetId: string, relationship: string, properties?: Record<string, any>): boolean {
    if (!this.nodes.has(sourceId) || !this.nodes.has(targetId)) {
      return false;
    }
    
    const edge: KnowledgeGraphEdge = {
      source: sourceId,
      target: targetId,
      relationship,
      properties
    };
    
    const edgeId = `${sourceId}_${relationship}_${targetId}`;
    this.edges.set(edgeId, edge);
    
    return true;
  }

  getRelatedNodes(nodeId: string, relationship?: string): KnowledgeGraphNode[] {
    const related: KnowledgeGraphNode[] = [];
    
    for (const edge of this.edges.values()) {
      if ((edge.source === nodeId || edge.target === nodeId) &&
          (!relationship || edge.relationship === relationship)) {
        const relatedId = edge.source === nodeId ? edge.target : edge.source;
        const node = this.nodes.get(relatedId);
        if (node) related.push(node);
      }
    }
    
    return related;
  }

  listEntries(options?: { verified?: boolean; minConfidence?: number }): LongTermMemoryEntry[] {
    let entries = Array.from(this.entries.values());
    
    if (options?.verified !== undefined) {
      entries = entries.filter(e => e.verified === options.verified);
    }
    
    if (options?.minConfidence !== undefined) {
      entries = entries.filter(e => e.confidence >= options.minConfidence);
    }
    
    return entries.sort((a, b) => b.confidence - a.confidence);
  }

  getStats(): {
    totalEntries: number;
    byType: Record<string, number>;
    verifiedCount: number;
    avgConfidence: number;
    nodesCount: number;
    edgesCount: number;
  } {
    const byType: Record<string, number> = {};
    let verified = 0;
    let totalConfidence = 0;
    
    for (const entry of this.entries.values()) {
      byType[entry.type] = (byType[entry.type] || 0) + 1;
      if (entry.verified) verified++;
      totalConfidence += entry.confidence;
    }
    
    return {
      totalEntries: this.entries.size,
      byType,
      verifiedCount: verified,
      avgConfidence: this.entries.size > 0 ? totalConfidence / this.entries.size : 0,
      nodesCount: this.nodes.size,
      edgesCount: this.edges.size
    };
  }
}

export default LongTermMemory;