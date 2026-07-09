import { describe, it, expect } from 'vitest';
import { createFileSystemTools } from '../src/plugins/tool/file-system/index.js';
import type { ConfigProvider } from '../src/sdk/config-provider.js';

const mockConfig: ConfigProvider = {
  getConfig: () => ({} as any),
  getModelConfig: () => ({} as any),
  getToolConfig: () => ({}),
  getBehaviorConfig: () => ({ workspaceRoot: '/tmp', name: 'test', maxTurns: 10, readOnly: false }),
  getMcpConfig: () => ({}),
};

describe('tool pattern derivation', () => {
  it('exec derives bash patterns', () => {
    const registry = createFileSystemTools(mockConfig, { enqueue: async () => {} } as any);
    const def = registry.getToolDefinition('exec');
    expect(def).toBeDefined();
    expect(def?.derivePatterns).toBeDefined();
    const patterns = def?.derivePatterns?.({ command: 'git status' } as any);
    expect(patterns).toContain('bash:git status');
    expect(patterns).toContain('bash:git *');
  });

  it('write derives file patterns and always options', () => {
    const registry = createFileSystemTools(mockConfig, { enqueue: async () => {} } as any);
    const def = registry.getToolDefinition('write');
    expect(def).toBeDefined();
    const patterns = def?.derivePatterns?.({ path: 'src/foo.ts' } as any);
    expect(patterns).toEqual(['file:src/foo.ts']);
    const options = def?.deriveAlwaysOptions?.({ path: 'src/foo.ts' } as any);
    expect(options?.map((o) => o.label)).toContain('src/foo.ts');
    expect(options?.map((o) => o.label)).toContain('src/*');
    expect(options?.map((o) => o.label)).toContain('*.ts');
  });
});
