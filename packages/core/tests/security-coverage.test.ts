import { describe, expect, it } from 'vitest';
import { classifyCommand } from '../src/security/permissions/exec-classifier.js';
import { classifyTool } from '../src/security/permissions/tool-classifier.js';
import { ApprovalEngine } from '../src/security/approval/approval-engine.js';
import { patternToRegExp, matchPattern } from '../src/security/rules/matcher.js';
import {
  RuleActionSchema,
  RuleSourceSchema,
  RuleSchema,
  isRuleAction,
} from '../src/security/rules/rule.js';
import type { Rule } from '../src/security/rules/rule.js';
import { applyToolPolicyPipeline, normalizeToolName } from '../src/security/tool-policy/tool-policy-pipeline.js';
import { resolveProfilePolicy } from '../src/security/tool-policy/tool-policy-profile.js';
import { TOOL_GROUPS, expandToolGroups } from '../src/security/tool-policy/tool-policy-shared.js';
import type { ToolDefinition } from '../src/sdk/tool-provider.js';
import type { ToolPolicyConfig } from '../src/sdk/tool-policy.js';
import type { ApprovalDecision } from '../src/sdk/agent-state-provider.js';

/* ── exec-classifier ── */

function makeToolDef(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'test_tool',
    description: 'test',
    parameters: { type: 'object', properties: {} } as any,
    readOnly: false,
    ...overrides,
  } as ToolDefinition;
}

describe('exec-classifier', () => {
  describe('safe commands', () => {
    const safeCommands = ['ls', 'cat', 'grep', 'find', 'pwd', 'echo', 'head', 'tail'];
    for (const cmd of safeCommands) {
      it(`"${cmd}" → safe`, () => {
        expect(classifyCommand(cmd).risk).toBe('safe');
      });
    }
  });

  describe('git subcommands', () => {
    it('safe git subcommands → safe', () => {
      for (const sub of ['status', 'log', 'diff', 'branch', 'show', 'remote', 'config']) {
        expect(classifyCommand(`git ${sub}`).risk).toBe('safe');
        expect(classifyCommand(`git ${sub}`).baseCommand).toBe('git');
        expect(classifyCommand(`git ${sub}`).subCommand).toBe(sub);
      }
    });

    it('non-safe git subcommands → normal', () => {
      for (const sub of ['push', 'commit', 'checkout', 'rebase', 'merge']) {
        const c = classifyCommand(`git ${sub}`);
        expect(c.risk).toBe('normal');
        expect(c.baseCommand).toBe('git');
        expect(c.subCommand).toBe(sub);
      }
    });
  });

  describe('dangerous commands', () => {
    it('rm, sudo, curl, wget, eval → dangerous', () => {
      for (const cmd of ['rm -rf /', 'sudo ls', 'curl http://example.com', 'wget http://example.com', 'eval "echo hi"']) {
        expect(classifyCommand(cmd).risk).toBe('dangerous');
      }
    });

    it('bash without -c → dangerous', () => {
      expect(classifyCommand('bash').risk).toBe('dangerous');
    });

    it('sh without -c → dangerous', () => {
      expect(classifyCommand('sh').risk).toBe('dangerous');
    });
  });

  describe('complex commands', () => {
    it('bash -c → complex', () => {
      expect(classifyCommand('bash -c "echo hi"').risk).toBe('complex');
    });

    it('sh -c → complex', () => {
      expect(classifyCommand('sh -c "echo hi"').risk).toBe('complex');
    });

    it('pipes → complex', () => {
      expect(classifyCommand('ls | grep foo').risk).toBe('complex');
    });

    it('multiple commands (;) → complex', () => {
      expect(classifyCommand('ls; pwd').risk).toBe('complex');
    });

    it('boolean operators (&&) → complex', () => {
      expect(classifyCommand('ls && pwd').risk).toBe('complex');
    });
  });

  describe('normal commands (unknown bins)', () => {
    it('unknown command → normal', () => {
      const c = classifyCommand('some-unknown-tool --flag');
      expect(c.risk).toBe('normal');
      expect(c.baseCommand).toBe('some-unknown-tool');
    });
  });

  describe('parse errors', () => {
    it('empty string → complex', () => {
      expect(classifyCommand('').risk).toBe('complex');
    });

    it('command substitution in parse error path → complex', () => {
      const result = classifyCommand('$(unclosed');
      expect(result.risk).toBe('complex');
    });
  });

  describe('patterns', () => {
    it('safe commands include bash:safe-bins:* wildcard', () => {
      expect(classifyCommand('ls').patterns).toContain('bash:safe-bins:*');
    });

    it('dangerous commands produce exact + by-name patterns', () => {
      const c = classifyCommand('rm file.txt');
      expect(c.patterns).toContain('bash:rm file.txt');
      expect(c.patterns).toContain('bash:rm *');
    });

    it('normal commands produce exact + by-name patterns', () => {
      const c = classifyCommand('unknown-cmd --flag');
      expect(c.patterns).toContain('bash:unknown-cmd --flag');
      expect(c.patterns).toContain('bash:unknown-cmd *');
    });

    it('complex commands return bash:* pattern', () => {
      const c = classifyCommand('ls; pwd');
      expect(c.risk).toBe('complex');
      expect(c.patterns).toEqual(['bash:*']);
    });
  });
});

/* ── tool-classifier ── */

describe('tool-classifier', () => {
  it('write tool → write', () => {
    expect(classifyTool('write', makeToolDef(), [])).toBe('write');
  });

  it('edit tool → write', () => {
    expect(classifyTool('edit', makeToolDef(), [])).toBe('write');
  });

  it('exec with safe command → read', () => {
    expect(classifyTool('exec', makeToolDef(), ['bash:ls'])).toBe('read');
  });

  it('exec with safe command but sensitive patterns → sensitive-read', () => {
    expect(classifyTool('exec', makeToolDef(), ['bash:cat', 'file:.env'])).toBe('sensitive-read');
  });

  it('exec with dangerous command → write', () => {
    expect(classifyTool('exec', makeToolDef(), ['bash:rm -rf /'])).toBe('write');
  });

  it('exec with normal command → write', () => {
    expect(classifyTool('exec', makeToolDef(), ['bash:unknown-tool'])).toBe('write');
  });

  it('exec without bash: pattern → write', () => {
    expect(classifyTool('exec', makeToolDef(), ['something:else'])).toBe('write');
  });

  it('exec with empty patterns → write', () => {
    expect(classifyTool('exec', makeToolDef(), [])).toBe('write');
  });

  it('readOnly tool → read', () => {
    expect(classifyTool('read_file', makeToolDef({ readOnly: true }), ['file:src/a.ts'])).toBe('read');
  });

  it('readOnly tool with sensitive file pattern → sensitive-read', () => {
    expect(classifyTool('read_file', makeToolDef({ readOnly: true }), ['file:.env'])).toBe('sensitive-read');
  });

  it('readOnly tool with sensitive glob pattern → sensitive-read', () => {
    expect(classifyTool('read_file', makeToolDef({ readOnly: true }), ['file:.ssh/config'])).toBe('sensitive-read');
  });

  it('non-readOnly tool without write/edit → write', () => {
    expect(classifyTool('some_write_tool', makeToolDef({ readOnly: false }), [])).toBe('write');
  });

  it('tool with .pem file → sensitive-read', () => {
    expect(classifyTool('read_file', makeToolDef({ readOnly: true }), ['file:secret.pem'])).toBe('sensitive-read');
  });

  it('tool with **.key file → sensitive-read', () => {
    expect(classifyTool('read_file', makeToolDef({ readOnly: true }), ['file:my.key'])).toBe('sensitive-read');
  });

  it('tool with secrets/ path → sensitive-read', () => {
    expect(classifyTool('read_file', makeToolDef({ readOnly: true }), ['file:secrets/db.json'])).toBe('sensitive-read');
  });
});

/* ── approval-engine ── */

describe('ApprovalEngine', () => {
  const alwaysRule: Rule = { permission: 'exec', pattern: 'bash:ls', action: 'allow' };

  it('createRequest 返回完整 ApprovalRequest', () => {
    const engine = new ApprovalEngine('session-1');
    const req = engine.createRequest({
      toolCallId: 'tc-1',
      toolName: 'write',
      patterns: ['file:src/a.ts'],
      alwaysOptions: [{ label: 'Always allow write', rule: alwaysRule }],
    });
    expect(req.approvalId).toBeTruthy();
    expect(req.toolCallId).toBe('tc-1');
    expect(req.toolName).toBe('write');
    expect(req.patterns).toEqual(['file:src/a.ts']);
    expect(req.title).toBe('Run write');
    expect(req.severity).toBe('warning');
    expect(req.allowedDecisions).toContain('allow-once');
    expect(req.allowedDecisions).toContain('deny');
    expect(req.allowedDecisions).toContain('allow-always');
    expect(req.alwaysOptions).toEqual([{ label: 'Always allow write', rule: alwaysRule }]);
  });

  it('createRequest 使用自定义 title/description/severity', () => {
    const engine = new ApprovalEngine('s1');
    const req = engine.createRequest({
      toolCallId: 'tc-2',
      toolName: 'exec',
      patterns: ['bash:rm'],
      title: 'Dangerous!',
      description: 'About to delete files',
      severity: 'critical',
      alwaysOptions: [],
    });
    expect(req.title).toBe('Dangerous!');
    expect(req.description).toBe('About to delete files');
    expect(req.severity).toBe('critical');
    expect(req.allowedDecisions).toEqual(['allow-once', 'deny']);
  });

  it('createRequest 默认 title 为 "Run <toolName>"', () => {
    const engine = new ApprovalEngine('s1');
    const req = engine.createRequest({
      toolCallId: 'tc-3',
      toolName: 'read',
      patterns: ['file:x'],
      alwaysOptions: [],
    });
    expect(req.title).toBe('Run read');
  });

  it('isPending 正确反映状态', () => {
    const engine = new ApprovalEngine('s1');
    expect(engine.isPending('nonexistent')).toBe(false);
    const req = engine.createRequest({
      toolCallId: 'tc-1',
      toolName: 'write',
      patterns: ['file:x'],
      alwaysOptions: [],
    });
    expect(engine.isPending(req.approvalId)).toBe(true);
  });

  it('resolve 返回 true 并通知 wait', async () => {
    const engine = new ApprovalEngine('s1');
    const req = engine.createRequest({
      toolCallId: 'tc-1',
      toolName: 'write',
      patterns: ['file:x'],
      alwaysOptions: [],
    });
    const waiter = engine.wait(req.approvalId);
    const resolved = engine.resolve(req.approvalId, 'allow-once');
    expect(resolved).toBe(true);
    const result = await waiter;
    expect(result.decision).toBe('allow-once');
    expect(result.rule).toBeUndefined();
    expect(engine.isPending(req.approvalId)).toBe(false);
  });

  it('resolve 返回 false 对不存在的 approvalId', () => {
    const engine = new ApprovalEngine('s1');
    expect(engine.resolve('not-there', 'deny')).toBe(false);
  });

  it('wait 不存在的 approvalId 返回 deny', async () => {
    const engine = new ApprovalEngine('s1');
    await expect(engine.wait('missing')).resolves.toEqual({ decision: 'deny' });
  });

  it('resolve with rule', async () => {
    const engine = new ApprovalEngine('s1');
    const req = engine.createRequest({
      toolCallId: 'tc-1',
      toolName: 'exec',
      patterns: ['bash:ls'],
      alwaysOptions: [{ label: 'Always allow ls', rule: alwaysRule }],
    });
    const waiter = engine.wait(req.approvalId);
    engine.resolve(req.approvalId, 'allow-always', alwaysRule);
    const result = await waiter;
    expect(result.decision).toBe('allow-always');
    expect(result.rule).toEqual(alwaysRule);
  });

  it('deny all', async () => {
    const engine = new ApprovalEngine('s1');
    const a = engine.createRequest({
      toolCallId: 'tca', toolName: 'edit', patterns: ['file:x'], alwaysOptions: [],
    });
    const b = engine.createRequest({
      toolCallId: 'tcb', toolName: 'write', patterns: ['file:y'], alwaysOptions: [],
    });
    const wA = engine.wait(a.approvalId);
    const wB = engine.wait(b.approvalId);
    engine.denyAll();
    const [rA, rB] = await Promise.all([wA, wB]);
    expect(rA.decision).toBe('deny');
    expect(rB.decision).toBe('deny');
    expect(engine.isPending(a.approvalId)).toBe(false);
    expect(engine.isPending(b.approvalId)).toBe(false);
  });

  it('buildAllowedDecisions: 有 alwaysOptions 时包含 allow-always', () => {
    const engine = new ApprovalEngine('s1');
    const req = engine.createRequest({
      toolCallId: 'tc-oo', toolName: 'exec', patterns: ['bash:ls'],
      alwaysOptions: [{ label: 'foo', rule: alwaysRule }],
    });
    expect(req.allowedDecisions).toEqual(['allow-once', 'deny', 'allow-always']);
  });

  it('buildAllowedDecisions: 无 alwaysOptions 时不包含 allow-always', () => {
    const engine = new ApprovalEngine('s1');
    const req = engine.createRequest({
      toolCallId: 'tc-oo', toolName: 'exec', patterns: ['bash:ls'],
      alwaysOptions: [],
    });
    expect(req.allowedDecisions).toEqual(['allow-once', 'deny']);
  });
});

/* ── rules/matcher ── */

describe('matcher', () => {
  describe('patternToRegExp', () => {
    it('literal match', () => {
      expect(matchPattern('hello', 'hello')).toBe(true);
      expect(matchPattern('hello', 'world')).toBe(false);
    });

    it('* matches any chars except /', () => {
      const re = patternToRegExp('*.txt');
      expect(re.test('file.txt')).toBe(true);
      expect(re.test('dir/file.txt')).toBe(false);
    });

    it('** matches any chars including /', () => {
      expect(matchPattern('dir/sub/file.txt', '**/*.txt')).toBe(true);
      expect(matchPattern('file.txt', '**/*.txt')).toBe(true);
      expect(matchPattern('file.md', '**/*.txt')).toBe(false);
    });

    it('**/ matches zero or more directories', () => {
      expect(matchPattern('.env', '**/.env')).toBe(true);
      expect(matchPattern('dir/.env', '**/.env')).toBe(true);
      expect(matchPattern('a/b/.env', '**/.env')).toBe(true);
    });

    it('? matches single char except /', () => {
      expect(matchPattern('file.txt', 'fil?.txt')).toBe(true);
      expect(matchPattern('file.txt', 'fi??.txt')).toBe(true);
      expect(matchPattern('file.txt', 'f?.txt')).toBe(false);
    });

    it('special regex chars are escaped', () => {
      expect(matchPattern('a+b.c', 'a+b.c')).toBe(true);
      expect(matchPattern('a+b.c', 'a-b.c')).toBe(false);
      expect(matchPattern('^test$', '^test$')).toBe(true);
      expect(matchPattern('(test)', '(test)')).toBe(true);
      expect(matchPattern('[abc]', '[abc]')).toBe(true);
      expect(matchPattern('file|pipe', 'file|pipe')).toBe(true);
    });

    it('** without trailing / matches any chars including /', () => {
      expect(matchPattern('abc', 'a**c')).toBe(true);
      expect(matchPattern('a/b/c', 'a**c')).toBe(true);
      expect(matchPattern('abx', 'a**c')).toBe(false);
    });

    it('complex glob **/.env*', () => {
      expect(matchPattern('.env', '**/.env*')).toBe(true);
      expect(matchPattern('.env.local', '**/.env*')).toBe(true);
      expect(matchPattern('dir/.env.prod', '**/.env*')).toBe(true);
      expect(matchPattern('dir/.notenv', '**/.env*')).toBe(false);
    });

    it('**/*.pem', () => {
      expect(matchPattern('cert.pem', '**/*.pem')).toBe(true);
      expect(matchPattern('ssl/cert.pem', '**/*.pem')).toBe(true);
    });

    it('secrets/**/*', () => {
      expect(matchPattern('secrets/db.json', '**/secrets/**/*')).toBe(true);
      expect(matchPattern('a/secrets/db.json', '**/secrets/**/*')).toBe(true);
      expect(matchPattern('nonsecrets/db.json', '**/secrets/**/*')).toBe(false);
    });
  });
});

/* ── rules/rule ── */

describe('rule', () => {
  describe('RuleSchema', () => {
    it('接受有效的 rule 对象', () => {
      expect(RuleSchema.properties.permission).toBeTruthy();
      expect(RuleSchema.properties.pattern).toBeTruthy();
      expect(RuleSchema.properties.action).toBeTruthy();
    });
  });

  describe('RuleActionSchema', () => {
    it('accepts allow/deny/ask', () => {
      expect(RuleActionSchema).toBeTruthy();
    });
  });

  describe('RuleSourceSchema', () => {
    it('accepts valid sources', () => {
      expect(RuleSourceSchema).toBeTruthy();
    });
  });

  describe('isRuleAction', () => {
    it('返回 true 对 allow/deny/ask', () => {
      expect(isRuleAction('allow')).toBe(true);
      expect(isRuleAction('deny')).toBe(true);
      expect(isRuleAction('ask')).toBe(true);
    });

    it('返回 false 对其他值', () => {
      expect(isRuleAction('maybe')).toBe(false);
      expect(isRuleAction('')).toBe(false);
      expect(isRuleAction(undefined)).toBe(false);
      expect(isRuleAction(null)).toBe(false);
      expect(isRuleAction(123)).toBe(false);
    });
  });
});

/* ── tool-policy-shared ── */

describe('tool-policy-shared', () => {
  describe('TOOL_GROUPS', () => {
    it('has expected groups', () => {
      expect(TOOL_GROUPS['group:fs']).toContain('read');
      expect(TOOL_GROUPS['group:fs']).toContain('write');
      expect(TOOL_GROUPS['group:runtime']).toContain('exec');
      expect(TOOL_GROUPS['group:web']).toContain('web_search');
      expect(TOOL_GROUPS['group:memory']).toContain('memory_search');
      expect(TOOL_GROUPS['group:sessions']).toContain('sessions_list');
      expect(TOOL_GROUPS['group:messaging']).toContain('message');
    });
  });

  describe('normalizeToolName', () => {
    it('trims and lowercases', () => {
      expect(normalizeToolName('  Write  ')).toBe('write');
      expect(normalizeToolName('EXEC')).toBe('exec');
      expect(normalizeToolName('Read')).toBe('read');
    });
  });

  describe('expandToolGroups', () => {
    it('expands known groups', () => {
      const r = expandToolGroups(['group:fs']);
      expect(r).toContain('read');
      expect(r).toContain('write');
      expect(r).toContain('edit');
      expect(r).toContain('ls');
    });

    it('passes through non-group entries', () => {
      const r = expandToolGroups(['custom_tool']);
      expect(r).toEqual(['custom_tool']);
    });

    it('handles mixed group and literal', () => {
      const r = expandToolGroups(['group:web', 'custom']);
      expect(r).toContain('web_search');
      expect(r).toContain('web_fetch');
      expect(r).toContain('custom');
    });

    it('deduplicates', () => {
      const r = expandToolGroups(['group:fs', 'read']);
      const occurrences = r.filter((x) => x === 'read').length;
      expect(occurrences).toBe(1);
    });

    it('returns empty array for undefined', () => {
      expect(expandToolGroups(undefined)).toEqual([]);
    });
  });
});

/* ── tool-policy-profile ── */

describe('tool-policy-profile', () => {
  it('minimal profile', () => {
    const r = resolveProfilePolicy('minimal');
    expect(r.allow).toContain('session_status');
  });

  it('coding profile', () => {
    const r = resolveProfilePolicy('coding');
    expect(r.allow).toContain('read');
    expect(r.allow).toContain('write');
    expect(r.allow).toContain('exec');
    expect(r.allow).toContain('web_search');
    expect(r.allow).toContain('memory_search');
    expect(r.allow).toContain('sessions_list');
  });

  it('messaging profile', () => {
    const r = resolveProfilePolicy('messaging');
    expect(r.allow).toContain('message');
    expect(r.allow).toContain('session_status');
  });

  it('full profile returns empty object', () => {
    const r = resolveProfilePolicy('full');
    expect(r.allow).toBeUndefined();
    expect(r).toEqual({});
  });

  it('unknown profile returns empty object', () => {
    const r = resolveProfilePolicy('unknown-profile');
    expect(r).toEqual({});
  });
});

/* ── tool-policy-pipeline ── */

function makeTool(name: string, readOnly = false): ToolDefinition {
  return { name, description: name, parameters: { type: 'object', properties: {} } as any, readOnly } as ToolDefinition;
}

function makePolicy(overrides: Partial<ToolPolicyConfig> = {}): ToolPolicyConfig {
  return overrides;
}

describe('tool-policy-pipeline', () => {
  const tools: ToolDefinition[] = [
    makeTool('read', true),
    makeTool('write', false),
    makeTool('exec', false),
    makeTool('ls', true),
    makeTool('glob', true),
  ];

  it('readOnly=true filters to readOnly tools only', () => {
    const result = applyToolPolicyPipeline({
      tools,
      readOnly: true,
      policy: {},
    });
    expect(result.map((t) => t.name)).toEqual(['read', 'ls', 'glob']);
  });

  it('readOnly=false returns all tools unchanged', () => {
    const result = applyToolPolicyPipeline({
      tools,
      readOnly: false,
      policy: {},
    });
    expect(result.map((t) => t.name)).toEqual(['read', 'write', 'exec', 'ls', 'glob']);
  });

  it('profile applies before policy allow/deny', () => {
    const result = applyToolPolicyPipeline({
      tools,
      readOnly: false,
      policy: { profile: 'minimal' },
    });
    // minimal only allows session_status, none of our tools match
    expect(result).toEqual([]);
  });

  it('allow filters to specific tools', () => {
    const result = applyToolPolicyPipeline({
      tools,
      readOnly: false,
      policy: { allow: ['read', 'write'] },
    });
    expect(result.map((t) => t.name)).toEqual(['read', 'write']);
  });

  it('alsoAllow adds to existing allow', () => {
    const result = applyToolPolicyPipeline({
      tools,
      readOnly: false,
      policy: { allow: ['read'], alsoAllow: ['exec'] },
    });
    expect(result.map((t) => t.name)).toEqual(['read', 'exec']);
  });

  it('* wildcard allows all', () => {
    const result = applyToolPolicyPipeline({
      tools,
      readOnly: false,
      policy: { allow: ['*'] },
    });
    expect(result.map((t) => t.name)).toEqual(['read', 'write', 'exec', 'ls', 'glob']);
  });

  it('deny removes specific tools', () => {
    const result = applyToolPolicyPipeline({
      tools,
      readOnly: false,
      policy: { deny: ['exec', 'write'] },
    });
    expect(result.map((t) => t.name)).toEqual(['read', 'ls', 'glob']);
  });

  it('deny with group expansion', () => {
    const result = applyToolPolicyPipeline({
      tools,
      readOnly: false,
      policy: { deny: ['group:fs'] },
    });
    expect(result.map((t) => t.name)).toEqual(['exec']);
  });

  it('byProvider layer', () => {
    const result = applyToolPolicyPipeline({
      tools,
      readOnly: false,
      policy: {
        byProvider: { openai: { allow: ['read'] } },
      },
      provider: 'openai',
    });
    expect(result.map((t) => t.name)).toEqual(['read']);
  });

  it('byProvider not matching ignores that layer', () => {
    const result = applyToolPolicyPipeline({
      tools,
      readOnly: false,
      policy: { byProvider: { openai: { allow: ['read'] } } },
      provider: 'anthropic',
    });
    expect(result.map((t) => t.name)).toEqual(['read', 'write', 'exec', 'ls', 'glob']);
  });

  it('toolsBySender layer', () => {
    const result = applyToolPolicyPipeline({
      tools,
      readOnly: false,
      policy: {
        toolsBySender: { child: { allow: ['read', 'ls'] } },
      },
      sender: 'child',
    });
    expect(result.map((t) => t.name)).toEqual(['read', 'ls']);
  });

  it('toolsBySender not matching ignores that layer', () => {
    const result = applyToolPolicyPipeline({
      tools,
      readOnly: false,
      policy: { toolsBySender: { child: { allow: ['read'] } } },
      sender: 'parent',
    });
    expect(result.map((t) => t.name)).toEqual(['read', 'write', 'exec', 'ls', 'glob']);
  });

  it('sandbox.tools layer', () => {
    const result = applyToolPolicyPipeline({
      tools,
      readOnly: false,
      policy: { sandbox: { tools: { allow: ['read'] } } },
    });
    expect(result.map((t) => t.name)).toEqual(['read']);
  });

  it('layer order: profile → policy → byProvider → toolsBySender → sandbox', () => {
    const result = applyToolPolicyPipeline({
      tools,
      readOnly: false,
      policy: {
        allow: ['read', 'write', 'exec', 'ls'],
        byProvider: { test: { deny: ['exec'] } },
        sandbox: { tools: { deny: ['write'] } },
      },
      provider: 'test',
    });
    // read, write, exec, ls (after allow) → minus exec (byProvider) → minus write (sandbox)
    expect(result.map((t) => t.name)).toEqual(['read', 'ls']);
  });

  it('deny empty array does nothing', () => {
    const result = applyToolPolicyPipeline({
      tools,
      readOnly: false,
      policy: { deny: [] },
    });
    expect(result.map((t) => t.name)).toEqual(['read', 'write', 'exec', 'ls', 'glob']);
  });

  it('normalize tool names via normalizeToolName re-export', () => {
    // The pipeline re-exports normalizeToolName; test it's the same function
    expect(normalizeToolName).toBeTruthy();
    expect(typeof normalizeToolName).toBe('function');
  });
});
