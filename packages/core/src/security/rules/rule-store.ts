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

export class RuleStore {
  private filePath: string;

  constructor(configDir = path.join(os.homedir(), '.config', 'rem')) {
    this.filePath = path.join(configDir, 'permissions.json');
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
