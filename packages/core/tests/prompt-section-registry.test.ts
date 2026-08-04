import type { PromptSection, PromptSectionRegistry } from 'rem-agent-core';
import {
  PromptSectionIdentityError,
  PromptSectionNotFoundError,
  ProtectedPromptSectionError,
} from 'rem-agent-core';
import { describe, expect, it } from 'vitest';
import { PromptSectionRegistryStore } from '../src/system-prompt/section-registry.js';

const section = (name: string, content = name): PromptSection => ({
  name,
  render: () => content,
});

describe('PromptSectionRegistryStore', () => {
  it('adds before runtime and replaces in place', () => {
    const store = new PromptSectionRegistryStore([
      section('alpha'), section('beta'), section('runtime'),
    ]);

    store.transact('plugin-a', (registry) => {
      registry.set('gamma', section('gamma'));
      registry.set('alpha', section('alpha', 'replaced'));
    });

    expect(store.finalize().map((item) => item.name)).toEqual([
      'alpha', 'beta', 'gamma', 'runtime',
    ]);
  });

  it('allows ordinary deletion and explicit movement', () => {
    const store = new PromptSectionRegistryStore([
      section('alpha'), section('beta'), section('runtime'),
    ]);

    store.transact('plugin-a', (registry) => {
      expect(registry.delete('missing')).toBe(false);
      expect(registry.delete('beta')).toBe(true);
      registry.set('gamma', section('gamma'));
      registry.moveBefore('gamma', 'alpha');
      registry.moveAfter('alpha', 'gamma');
    });

    expect(store.finalize().map((item) => item.name)).toEqual([
      'gamma', 'alpha', 'runtime',
    ]);
  });

  it('replaces runtime content without moving it', async () => {
    const store = new PromptSectionRegistryStore([
      section('alpha'), section('runtime', 'old'),
    ]);

    store.transact('plugin-a', (registry) => {
      registry.set('runtime', section('runtime', 'new'));
    });

    const snapshot = store.finalize();
    expect(snapshot.map((item) => item.name)).toEqual(['alpha', 'runtime']);
    expect(await snapshot[1].render({} as never)).toBe('new');
  });

  it('protects runtime position and existence', () => {
    const createStore = () => new PromptSectionRegistryStore([
      section('alpha'), section('runtime'),
    ]);

    expect(() => createStore().transact('plugin-a', (registry) => {
      registry.delete('runtime');
    })).toThrow(ProtectedPromptSectionError);
    expect(() => createStore().transact('plugin-a', (registry) => {
      registry.moveBefore('runtime', 'alpha');
    })).toThrow(ProtectedPromptSectionError);
    expect(() => createStore().transact('plugin-a', (registry) => {
      registry.moveAfter('alpha', 'runtime');
    })).toThrow(ProtectedPromptSectionError);
  });

  it('rejects invalid identities and missing movement targets', () => {
    const createStore = () => new PromptSectionRegistryStore([
      section('alpha'), section('runtime'),
    ]);

    expect(() => createStore().transact('plugin-a', (registry) => {
      registry.set('wrong', section('actual'));
    })).toThrow(PromptSectionIdentityError);
    expect(() => createStore().transact('plugin-a', (registry) => {
      registry.moveBefore('missing', 'alpha');
    })).toThrow(PromptSectionNotFoundError);
    expect(() => createStore().transact('plugin-a', (registry) => {
      registry.moveBefore('alpha', 'missing');
    })).toThrow(PromptSectionNotFoundError);
  });

  it('rolls back a failed transaction and expires its registry view', () => {
    const store = new PromptSectionRegistryStore([
      section('alpha'), section('runtime'),
    ]);
    let retained: PromptSectionRegistry | undefined;

    expect(() => store.transact('plugin-a', (registry) => {
      retained = registry;
      registry.set('temporary', section('temporary'));
      throw new Error('stop');
    })).toThrow('stop');

    expect(store.finalize().map((item) => item.name)).toEqual(['alpha', 'runtime']);
    expect(() => retained?.set('late', section('late'))).toThrow('no longer active');
  });

  it('records replacement provenance without exposing mutable state', () => {
    const store = new PromptSectionRegistryStore([
      section('alpha'), section('runtime'),
    ]);
    store.transact('plugin-a', (registry) => registry.set('alpha', section('alpha', 'a')));
    store.transact('plugin-b', (registry) => registry.set('alpha', section('alpha', 'b')));

    expect(store.diagnostics()).toEqual([
      { name: 'alpha', source: 'plugin-b', history: ['core', 'plugin-a', 'plugin-b'] },
      { name: 'runtime', source: 'core', history: ['core'] },
    ]);
    expect(Object.isFrozen(store.finalize())).toBe(true);
  });
});
