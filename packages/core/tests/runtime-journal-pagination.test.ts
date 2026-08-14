import { describe, expect, it } from 'vitest';
import { readNodeJournal } from '../src/execution/run-execution-journal-reader.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';

describe('execution journal pagination', () => {
  it('reads beyond the legacy 10,000-entry boundary', async () => {
    const { store } = await createFakeRuntimeStore();
    await store.transaction((uow) => {
      for (let sequence = 1; sequence <= 10_001; sequence += 1) {
        uow.executionEntries.append({ entryId: `entry-${sequence}`, tenantId: 'tenant', runId: 'run', nodeId: 'run:root', sequence, kind: 'control', data: { sequence }, audience: 'internal', visibility: 'run', createdAt: new Date(sequence) });
      }
    });
    const entries = await store.transaction((uow) => readNodeJournal(uow, 'run', 'run:root'));
    expect(entries).toHaveLength(10_001);
    expect(entries.at(-1)?.sequence).toBe(10_001);
  });
});
