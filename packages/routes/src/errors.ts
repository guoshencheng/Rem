import { ServiceError } from 'rem-agent-bridge';

export function toErrorResponse(err: unknown): Response {
  if (err instanceof ServiceError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof SyntaxError) {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const message = err instanceof Error ? err.message : 'Internal error';
  return Response.json({ error: message }, { status: 500 });
}
