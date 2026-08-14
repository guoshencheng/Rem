import { RuntimeError } from 'rem-agent-core';

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new RuntimeError('INVALID_INPUT', 'Request content type must be application/json');
  }
  let value: unknown;
  try {
    value = await request.json();
  } catch (error) {
    throw new RuntimeError('INVALID_INPUT', 'Request body must be valid JSON', false, undefined, { cause: error });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeError('INVALID_INPUT', 'Request body must be a JSON object');
  }
  return value as Record<string, unknown>;
}

export function readIntegerQuery(
  url: URL,
  name: string,
  options: { min: number; max: number; defaultValue?: number },
): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return options.defaultValue;
  if (!/^[0-9]+$/.test(raw)) throw new RuntimeError('INVALID_INPUT', `${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < options.min || value > options.max) {
    throw new RuntimeError('INVALID_INPUT', `${name} is outside the allowed range`);
  }
  return value;
}
