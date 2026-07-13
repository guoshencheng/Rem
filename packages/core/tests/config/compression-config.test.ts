import { describe, it, expect } from 'vitest';
import { pickCompressionConfig } from '../../src/plugins/config/default/config-parser.js';
import { applyBehaviorDefaults } from '../../src/plugins/config/default/config-merger.js';
import type { AgentConfig } from '../../src/sdk/config-provider.js';

describe('CompressionConfig', () => {
  it('returns defaults when no config provided', () => {
    const config: AgentConfig = {};
    const defaults = applyBehaviorDefaults(config, '/tmp/sessions');
    expect(defaults.compression.enabled).toBe(true);
    expect(defaults.compression.thresholdRatio).toBe(0.8);
    expect(defaults.compression.protectHead).toBe(3);
    expect(defaults.compression.protectTail).toBe(20);
  });

  it('respects config overrides', () => {
    const config: AgentConfig = {
      compression: {
        enabled: false,
        thresholdRatio: 0.6,
      },
    };
    const defaults = applyBehaviorDefaults(config, '/tmp/sessions');
    expect(defaults.compression.enabled).toBe(false);
    expect(defaults.compression.thresholdRatio).toBe(0.6);
    expect(defaults.compression.protectHead).toBe(3);
  });

  describe('pickCompressionConfig', () => {
    it('returns undefined for non-object', () => {
      expect(pickCompressionConfig(null)).toBeUndefined();
      expect(pickCompressionConfig('string')).toBeUndefined();
    });

    it('returns config for valid object', () => {
      const cfg = pickCompressionConfig({ enabled: false, thresholdRatio: 0.5 });
      expect(cfg).toEqual({ enabled: false, thresholdRatio: 0.5 });
    });

    it('ignores unknown keys', () => {
      const cfg = pickCompressionConfig({ enabled: true, unknown: 'ignored' });
      expect(cfg).toEqual({ enabled: true });
    });
  });
});
