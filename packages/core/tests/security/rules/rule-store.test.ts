import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { RuleStore } from '../../../src/security/rules/rule-store.js';

describe('RuleStore', () => {
  let tmpDir: string;
  let store: RuleStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rem-rules-'));
    store = new RuleStore(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('loads empty rules when file does not exist', async () => {
    const rules = await store.loadAll();
    expect(rules).toEqual([]);
  });

  it('saves and loads approved rules', async () => {
    await store.saveApproved({ permission: 'exec', pattern: 'git *', action: 'allow' });
    const rules = await store.loadBySource('approved');
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ permission: 'exec', pattern: 'git *', action: 'allow', source: 'approved' });
  });

  it('returns empty array for corrupt file', async () => {
    await fs.writeFile(path.join(tmpDir, 'permissions.json'), 'not json');
    const rules = await store.loadAll();
    expect(rules).toEqual([]);
  });
});
