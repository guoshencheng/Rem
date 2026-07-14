import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Rule, RuleSource } from '../../../security/rules/rule.js';
import type { RuleStorage } from '../../../sdk/storage-provider.js';
import { wrapSqliteError } from './errors.js';

interface RuleRow {
  id: string;
  source: RuleSource;
  permission: string;
  pattern: string;
  action: string;
  created_at: string;
}

export class SqliteRuleStore implements RuleStorage {
  constructor(private db: Database.Database) {}

  async loadAll(): Promise<Rule[]> {
    return this.loadBySources(['user-config', 'approved']);
  }

  async loadBySource(source: RuleSource): Promise<Rule[]> {
    return this.loadBySources([source]);
  }

  async saveApproved(rule: Omit<Rule, 'source'>): Promise<void> {
    try {
      const existing = this.db
        .prepare(
          'SELECT id FROM rules WHERE source = ? AND permission = ? AND pattern = ? AND action = ?'
        )
        .get('approved', rule.permission, rule.pattern, rule.action) as { id: string } | undefined;

      if (existing) return;

      this.db
        .prepare(
          'INSERT INTO rules (id, source, permission, pattern, action, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(
          randomUUID(),
          'approved',
          rule.permission,
          rule.pattern,
          rule.action,
          new Date().toISOString()
        );
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', 'Failed to save approved rule');
    }
  }

  private loadBySources(sources: RuleSource[]): Promise<Rule[]> {
    try {
      if (sources.length === 0) return Promise.resolve([]);
      const placeholders = sources.map(() => '?').join(',');
      const rows = this.db
        .prepare(`SELECT * FROM rules WHERE source IN (${placeholders})`)
        .all(...sources) as RuleRow[];

      return Promise.resolve(
        rows.map((r) => ({
          permission: r.permission,
          pattern: r.pattern,
          action: r.action as Rule['action'],
          source: r.source,
        }))
      );
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', 'Failed to load rules');
    }
  }
}
