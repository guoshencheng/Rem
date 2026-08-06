import type { Context } from 'hono';

const NOT_FOUND_PATTERN = /not found|unknown|does not belong/i;
const CONFLICT_PATTERN = /already running/i;

export function toErrorResponse(err: unknown, c: Context): Response {
  const message = err instanceof Error ? err.message : String(err);
  const status = NOT_FOUND_PATTERN.test(message) ? 404 : CONFLICT_PATTERN.test(message) ? 409 : 500;
  return c.json({ error: message }, status as 404 | 409 | 500);
}
