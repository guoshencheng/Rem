import { Type } from '@sinclair/typebox';
import type { CustomTool } from 'rem-agent-ui/local';

export const calculatorTool: CustomTool = {
  definition: {
    name: 'calculator',
    description: 'Evaluate a JavaScript arithmetic expression like "2 * (3 + 4)".',
    parameters: Type.Object({
      expression: Type.String({ description: 'Arithmetic expression' }),
    }),
    readOnly: true,
  },
  executor: async (input) => {
    const expr = (input as { expression: string }).expression;
    if (!/^[\d\s+\-*/().%]+$/.test(expr)) {
      return { output: 'Error: only arithmetic characters are allowed' };
    }
    try {
      const result = Function(`"use strict"; return (${expr})`)();
      return { output: String(result) };
    } catch (err) {
      return { output: `Error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

export const webFetchTool: CustomTool = {
  definition: {
    name: 'web_fetch',
    description: 'Fetch a URL and return the first 2000 characters of the body (subject to CORS).',
    parameters: Type.Object({
      url: Type.String({ description: 'URL to fetch' }),
    }),
    readOnly: true,
  },
  executor: async (input) => {
    const { url } = input as { url: string };
    try {
      const res = await fetch(url);
      const text = await res.text();
      return { output: text.slice(0, 2000) };
    } catch (err) {
      return { output: `Error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
