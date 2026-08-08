import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/client/index.css', import.meta.url), 'utf8');

describe('Compact Dark Workbench tokens', () => {
  it.each([
    ['--ds-bg', '#08090c'],
    ['--ds-panel', '#12141a'],
    ['--ds-primary', '#6752da'],
    ['--ds-selected-bg', '#28233d'],
    ['--ds-topbar-height', '48px'],
    ['--ds-statusbar-height', '26px'],
    ['--ds-left-panel-width', '205px'],
    ['--ds-right-panel-width', '268px'],
  ])('定义 %s', (token, value) => {
    expect(css).toContain(`${token}: ${value}`);
  });

  it('让 shadcn 语义色引用源 token', () => {
    expect(css).toContain('--primary: var(--ds-primary)');
    expect(css).toContain('--accent: var(--ds-selected-bg)');
  });
});
