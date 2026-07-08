const THINKING_NAMES = ["think", "thinking", "thought"];
const ASCII_LOWER_OFFSET = 32;

function equalsLowercaseAscii(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    let ca = a.charCodeAt(i);
    let cb = b.charCodeAt(i);
    // Fast path: exact match
    if (ca === cb) continue;
    // Case-insensitive for ASCII letters
    if (ca >= 65 && ca <= 90) ca += ASCII_LOWER_OFFSET;
    if (cb >= 65 && cb <= 90) cb += ASCII_LOWER_OFFSET;
    if (ca !== cb) return false;
  }
  return true;
}

function isReasoningTagPrefix(text: string): boolean {
  if (!text.startsWith("<") || text.includes(">")) {
    return false;
  }

  // Strip leading whitespace and optional '/'
  let i = 1;
  while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\r" || text[i] === "\n")) {
    i++;
  }
  if (i < text.length && text[i] === "/") {
    i++;
  }

  // Skip optional namespace prefix (e.g. "mm:")
  let nameStart = i;
  while (i < text.length && /[\w-]/.test(text[i])) {
    i++;
  }
  if (i < text.length && text[i] === ":") {
    i++;
    nameStart = i;
    while (i < text.length && /[\w-]/.test(text[i])) {
      i++;
    }
  } else {
    // Reset and try without namespace
    i = nameStart;
  }

  const namePart = text.slice(nameStart, i);
  if (namePart.length === 0) return true; // just "<" with optional whitespace/namespace

  // case-insensitive match against known thinking tag names
  for (const name of THINKING_NAMES) {
    if (equalsLowercaseAscii(name, namePart.slice(0, name.length))) return true;
    if (name.startsWith(namePart.toLowerCase())) return true;
  }
  return false;
}

export function findIncompleteTagPrefix(text: string): number {
  for (let i = text.lastIndexOf("<"); i >= 0; i = text.lastIndexOf("<", i - 1)) {
    if (isReasoningTagPrefix(text.slice(i))) {
      return i;
    }
  }
  return -1;
}
