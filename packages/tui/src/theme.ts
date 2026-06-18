import type { MarkdownTheme, DefaultTextStyle } from "@earendil-works/pi-tui";
import { bold, dim, blue, yellow, cyan, italic, underline, strikethrough } from "./colors.js";

export const markdownTheme: MarkdownTheme = {
  heading: bold,
  link: blue,
  linkUrl: dim,
  code: yellow,
  codeBlock: yellow,
  codeBlockBorder: dim,
  quote: italic,
  quoteBorder: dim,
  hr: dim,
  listBullet: cyan,
  bold: bold,
  italic: italic,
  strikethrough: strikethrough,
  underline: underline,
};

export const userMessageStyle: DefaultTextStyle = {
  bgColor: (text) => `\x1b[48;5;236m${text}\x1b[0m`,
};

export const assistantMessageStyle: DefaultTextStyle = {
  color: (text) => text,
};

export const thinkingMessageStyle: DefaultTextStyle = {
  color: dim,
};

export const toolMessageStyle: DefaultTextStyle = {
  color: dim,
};

export const eventLogStyle: DefaultTextStyle = {
  color: dim,
};
