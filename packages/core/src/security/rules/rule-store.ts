import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Rule, RuleSource } from './rule.js';

export interface StoredPermissions {
  version: number;
  approved?: Rule[];
  user?: Rule[];
  profiles?: Record<string, Rule[]>;
}

/**
 * 本地规则持久化。默认写入统一 agentDir（~/.rem-agent/permissions.json），
 * 与 sessions / debug log / config 共享同一根目录；可通过 REM_AGENT_HOME 覆盖。
 */
export class RuleStore {
  private filePath: string;

  constructor(agentDir: string = path.join(os.homedir(), '.rem-agent')) {
    this.filePath = path.join(agentDir, 'permissions.json');
  }

  /** 当前持久化文件路径，便于测试与诊断 */
  get location(): string {
    return this.filePath;
  }

  async loadAll(): Promise<Rule[]> {
    const stored = await this.loadStored();
    return [
      ...(stored.user ?? []).map((r) => ({ ...r, source: 'user-config' as RuleSource })),
      ...(stored.approved ?? []).map((r) => ({ ...r, source: 'approved' as RuleSource })),
    ];
  }

  async loadBySource(source: RuleSource): Promise<Rule[]> {
    const all = await this.loadAll();
    return all.filter((r) => r.source === source);
  }

  async saveApproved(rule: Omit<Rule, 'source'>): Promise<void> {
    const stored = await this.loadStored();
    stored.approved = stored.approved ?? [];
    if (!stored.approved.some((r) => r.permission === rule.permission && r.pattern === rule.pattern)) {
      stored.approved.push(rule);
    }
    await this.saveStored(stored);
  }

  private async loadStored(): Promise<StoredPermissions> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as StoredPermissions;
      if (parsed.version !== 1) return { version: 1 };
      return parsed;
    } catch {
      return { version: 1 };
    }
  }

  private async saveStored(stored: StoredPermissions): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(stored, null, 2) + '\n');
  }
}
