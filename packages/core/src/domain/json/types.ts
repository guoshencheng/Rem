/** JSON-compatible values used at Runtime boundaries. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Draft 2020-12 JSON Schema. Runtime validation is performed by Ajv 2020. */
export type JsonSchema = { readonly [key: string]: JsonValue | undefined };
