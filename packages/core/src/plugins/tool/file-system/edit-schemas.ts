import { Type, type Static } from '@sinclair/typebox';

export const replaceEditSchema = Type.Object(
  {
    oldText: Type.String({
      description:
        'Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.',
    }),
    newText: Type.String({ description: 'Replacement text for this targeted edit.' }),
  },
  { additionalProperties: false },
);

export const editSchema = Type.Object(
  {
    path: Type.String({ description: 'Path to the file to edit (relative or absolute)' }),
    edits: Type.Array(replaceEditSchema, {
      description:
        'One or more targeted replacements. Each edit is matched against the original file, not incrementally.',
    }),
  },
  { additionalProperties: false },
);

export type EditToolInput = Static<typeof editSchema>;
