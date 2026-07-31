import { Marked, Renderer } from 'marked';
import markedShiki from 'marked-shiki';
import { createHighlighter } from 'shiki';

const THEME = 'github-dark';

const COMMON_LANGS = [
  'javascript',
  'typescript',
  'jsx',
  'tsx',
  'json',
  'markdown',
  'md',
  'bash',
  'shell',
  'python',
  'rust',
  'go',
  'html',
  'css',
  'yaml',
  'sql',
  'text',
  'plaintext',
] as const;

const highlighterPromise = createHighlighter({
  themes: [THEME],
  langs: COMMON_LANGS as unknown as string[],
});

let highlighterCache: Awaited<typeof highlighterPromise> | null = null;

async function getHighlighter() {
  if (!highlighterCache) {
    highlighterCache = await highlighterPromise;
  }
  return highlighterCache;
}

const renderer = new Renderer();

renderer.table = ({ header, rows }) => {
  let headerHtml = '<thead><tr>';
  for (const cell of header) {
    headerHtml += `<th class="border border-bd2 px-3 py-1.5 bg-bd text-tx2 font-medium text-left">${cell.text}</th>`;
  }
  headerHtml += '</tr></thead>';

  let bodyHtml = '<tbody>';
  for (const row of rows) {
    bodyHtml += '<tr>';
    for (const cell of row) {
      bodyHtml += `<td class="border border-bd2 px-3 py-1.5 text-tx">${cell.text}</td>`;
    }
    bodyHtml += '</tr>';
  }
  bodyHtml += '</tbody>';

  return `<div class="overflow-x-auto my-2"><table class="min-w-full border-collapse border border-bd2 text-xs">${headerHtml}${bodyHtml}</table></div>`;
};

export async function renderMarkdown(text: string): Promise<string> {
  const highlighter = await getHighlighter();
  const loadedLangs = highlighter.getLoadedLanguages();

  const marked = new Marked({ gfm: true });
  marked.use(
    markedShiki({
      highlight(code, lang) {
        const language = loadedLangs.includes(lang as never) ? lang : 'text';
        return highlighter.codeToHtml(code, { lang: language, theme: THEME });
      },
    }),
  );
  marked.use({ renderer });

  return marked.parse(text) as string;
}
