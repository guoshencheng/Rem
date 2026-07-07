import { Type, type TSchema, type TObject } from '@sinclair/typebox';

export function convertJsonSchemaToTypeBox(schema: unknown): TSchema {
  return convertNode(schema);
}

export function convertJsonSchemaToTypeBoxObject(schema: unknown): TObject {
  const converted = convertJsonSchemaToTypeBox(schema);
  if (converted.type === 'object') {
    return converted as TObject;
  }
  return Type.Object({}, { additionalProperties: true });
}

function convertNode(node: unknown): TSchema {
  if (typeof node !== 'object' || node === null) {
    return Type.Any();
  }

  const s = node as Record<string, unknown>;

  if (s.anyOf !== undefined || s.oneOf !== undefined || s.allOf !== undefined) {
    return Type.Any();
  }

  const type = s.type;

  switch (type) {
    case 'object': {
      const properties: Record<string, TSchema> = {};
      const rawProperties = s.properties;
      if (typeof rawProperties === 'object' && rawProperties !== null) {
        for (const [key, value] of Object.entries(rawProperties)) {
          properties[key] = convertNode(value);
        }
      }
      const additionalProperties = s.additionalProperties;
      return Type.Object(properties, {
        additionalProperties: additionalProperties === true,
      });
    }
    case 'array': {
      const items = s.items;
      const itemType = typeof items === 'object' && items !== null ? convertNode(items) : Type.Any();
      return Type.Array(itemType);
    }
    case 'string': {
      const description = typeof s.description === 'string' ? s.description : undefined;
      if (Array.isArray(s.enum)) {
        return Type.Union(s.enum.map((v) => Type.Literal(String(v))), { description });
      }
      return Type.String({ description });
    }
    case 'integer':
      return Type.Integer();
    case 'number':
      return Type.Number();
    case 'boolean':
      return Type.Boolean();
    default:
      return Type.Any();
  }
}
