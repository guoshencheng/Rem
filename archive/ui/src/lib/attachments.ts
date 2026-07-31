import type { UserInputContent } from 'rem-agent-core';

export const TEXT_FILE_MAX_BYTES = 100 * 1024;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_TEXT_FILES = 5;
export const MAX_IMAGES = 4;

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs',
  'java', 'c', 'cpp', 'h', 'hpp', 'css', 'html', 'xml', 'yml', 'yaml', 'toml',
  'sh', 'bash', 'zsh', 'log', 'csv', 'sql', 'vue', 'svelte', 'env', 'ini', 'conf',
]);

export interface TextAttachment {
  name: string;
  text: string;
}

export interface ImageAttachment {
  name: string;
  data: string;
  mimeType: string;
  dataUrl: string;
}

export function isTextFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  if (file.type === 'application/json') return true;
  if (file.type && file.type !== '') return false;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return TEXT_EXTENSIONS.has(ext);
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function readFileAsImageAttachment(file: File): Promise<ImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const comma = dataUrl.indexOf(',');
      resolve({
        name: file.name,
        data: dataUrl.slice(comma + 1),
        mimeType: file.type || 'image/png',
        dataUrl,
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function buildUserInputContent(
  text: string,
  textFiles: TextAttachment[],
  images: ImageAttachment[],
): UserInputContent {
  const prefix = textFiles.map((f) => `<file name="${f.name}">\n${f.text}\n</file>`).join('\n');
  const fullText = prefix ? `${prefix}\n\n${text}` : text;
  if (images.length === 0) return fullText;
  return [
    { type: 'text', text: fullText },
    ...images.map((img) => ({ type: 'image' as const, data: img.data, mimeType: img.mimeType })),
  ];
}
