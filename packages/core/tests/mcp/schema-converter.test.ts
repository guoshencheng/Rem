import { describe, it, expect } from 'vitest';
import { TypeGuard } from '@sinclair/typebox';
import { convertJsonSchemaToTypeBox, convertJsonSchemaToTypeBoxObject } from '../../src/mcp/schema-converter.js';

describe('convertJsonSchemaToTypeBox', () => {
  it('converts object with string property', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string', description: 'The name' } },
      required: ['name'],
    };
    const result = convertJsonSchemaToTypeBox(schema);
    expect(result).toBeDefined();
    expect(result.type).toBe('object');
  });

  it('converts number and integer', () => {
    const schema = {
      type: 'object',
      properties: { count: { type: 'integer' }, ratio: { type: 'number' } },
    };
    const result = convertJsonSchemaToTypeBox(schema);
    expect(result.type).toBe('object');
    expect(result.properties?.count.type).toBe('integer');
    expect(result.properties?.ratio.type).toBe('number');
  });

  it('converts array', () => {
    const schema = {
      type: 'object',
      properties: { items: { type: 'array', items: { type: 'string' } } },
    };
    const result = convertJsonSchemaToTypeBox(schema);
    expect(result.type).toBe('object');
    expect(result.properties?.items.type).toBe('array');
    expect(result.properties?.items.items.type).toBe('string');
  });

  it('converts enum to union literals', () => {
    const schema = {
      type: 'object',
      properties: { level: { type: 'string', enum: ['low', 'high'] } },
    };
    const result = convertJsonSchemaToTypeBox(schema);
    expect(result.type).toBe('object');
    expect(result.properties?.level.anyOf).toHaveLength(2);
  });

  it('falls back to Any for anyOf', () => {
    const schema = {
      type: 'object',
      properties: {
        mixed: { anyOf: [{ type: 'string' }, { type: 'number' }] },
      },
    };
    const result = convertJsonSchemaToTypeBox(schema);
    expect(result.type).toBe('object');
    expect(TypeGuard.TAny(result.properties?.mixed)).toBe(true);
  });

  it('returns string for top-level string', () => {
    const result = convertJsonSchemaToTypeBox({ type: 'string' });
    expect(result.type).toBe('string');
  });
});

describe('convertJsonSchemaToTypeBoxObject', () => {
  it('returns object schema for object input', () => {
    const result = convertJsonSchemaToTypeBoxObject({ type: 'object', properties: {} });
    expect(result.type).toBe('object');
  });

  it('returns empty object for non-object input', () => {
    const result = convertJsonSchemaToTypeBoxObject({ type: 'string' });
    expect(result.type).toBe('object');
  });
});

describe('convertJsonSchemaToTypeBoxObject', () => {
  it('returns object schema for object input', () => {
    const result = convertJsonSchemaToTypeBoxObject({ type: 'object', properties: {} });
    expect(result.type).toBe('object');
  });

  it('returns empty object for non-object input', () => {
    const result = convertJsonSchemaToTypeBoxObject({ type: 'string' });
    expect(result.type).toBe('object');
  });
});
