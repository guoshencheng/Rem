import { NextResponse } from 'next/server';
import type { BusEvent } from 'rem-agent-bridge';
import { bus, createBusSSEResponse } from 'rem-agent-bridge';

function busToAsyncIterable(): AsyncIterable<BusEvent> {
  console.log('[SSE-endpoint] busToAsyncIterable called, subscribing to bus');
  let resolveNext: ((event: BusEvent) => void) | null = null;
  const queue: BusEvent[] = [];

  const unsub = bus.subscribe((event) => {
    console.log(`[SSE-endpoint] bus event recv session=${event.sessionId} type=${event.type} workspace=${event.workspace}`);
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
        console.log('[SSE-endpoint] client connected');
        let count = 0;
        while (true) {
          if (queue.length > 0) {
            const event = queue.shift()!;
            count++;
            console.log(`[SSE-endpoint] yield #${count} session=${event.sessionId} type=${event.type}`);
            yield event;
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
  console.log('[SSE-endpoint] GET /api/agent/stream matched');
  try {
    const busStream = busToAsyncIterable();
    return createBusSSEResponse(busStream);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
