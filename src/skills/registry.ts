export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  description: string;
  default?: unknown;
}

export interface SkillReturn {
  type: string;
  description: string;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  category: 'system' | 'browser' | 'office' | 'communication' | 'custom';
  parameters: SkillParameter[];
  returns: SkillReturn;
  handler: (...args: unknown[]) => Promise<ToolResult>;
  enabled: boolean;
  version: string;
}

export interface ToolResult {
  success: boolean;
  result?: any;
  error?: string;
}

export class SkillRegistry {
  private skills = new Map<string, SkillDefinition>();

  register(skill: SkillDefinition): void {
    if (this.skills.has(skill.id)) {
      console.warn(`Skill ${skill.id} already registered, overwriting`);
    }
    this.skills.set(skill.id, skill);
  }

  unregister(skillId: string): boolean {
    return this.skills.delete(skillId);
  }

  get(skillId: string): SkillDefinition | undefined {
    return this.skills.get(skillId);
  }

  has(skillId: string): boolean {
    return this.skills.has(skillId);
  }

  list(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  listByCategory(category: SkillDefinition['category']): SkillDefinition[] {
    return this.list().filter((s) => s.category === category);
  }

  async execute(skillId: string, args: unknown[] = []): Promise<ToolResult> {
    const skill = this.get(skillId);

    if (!skill) {
      return {
        success: false,
        error: `Skill not found: ${skillId}`,
      };
    }

    if (!skill.enabled) {
      return {
        success: false,
        error: `Skill is disabled: ${skillId}`,
      };
    }

    try {
      return await skill.handler(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Skill execution failed: ${message}`,
      };
    }
  }

  count(): number {
    return this.skills.size;
  }

  getAll(): string[] {
    return Array.from(this.skills.keys());
  }

  clear(): void {
    this.skills.clear();
  }
}

export const globalSkillRegistry = new SkillRegistry();

export default SkillRegistry;