import { NextResponse } from 'next/server';
import type { BusEvent } from 'rem-agent-bridge';
import { bus, createBusSSEResponse, getStreamingSnapshotEvents } from 'rem-agent-bridge';

const WORKSPACE = 'default';

function busToAsyncIterable(): AsyncIterable<BusEvent> {
  let resolveNext: ((event: BusEvent) => void) | null = null;
  const queue: BusEvent[] = [];

  const unsub = bus.subscribe((event) => {
    if (event.workspace !== WORKSPACE) return;
    if (resolveNext) {
      resolveNext(event);
      resolveNext = null;
    } else {
      queue.push(event);
    }
  });

  return {
    [Symbol.asyncIterator]: async function* () {
      try {
        // Replay in-flight snapshots to this new subscriber first, then live
        // bus events. subscribe() above already ran synchronously, so any chunk
        // published after this point is queued — snapshot + queue are gap-free.
        for (const ev of getStreamingSnapshotEvents(WORKSPACE)) {
          yield ev;
        }
        while (true) {
          if (queue.length > 0) {
            yield queue.shift()!;
          } else {
            yield await new Promise<BusEvent>((r) => { resolveNext = r; });
          }
        }
      } finally {
        unsub();
      }
    },
  };
}

export async function GET() {
  try {
    return createBusSSEResponse(busToAsyncIterable());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
