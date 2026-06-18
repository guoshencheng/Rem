function isReasoningTagPrefix(text: string): boolean {
  if (!text.startsWith("<") || text.includes(">")) {
    return false;
  }
  let afterBracket = text
    .slice(1)
    .replace(/^\s*\/?\s*/, "")
    .toLowerCase()
    .trimStart();
  if (afterBracket.length === 0) {
    return true;
  }
  afterBracket = afterBracket.replace(/^[\w-]+:/, "");
  const names = ["think", "thinking", "thought"];
  return names.some((name) => name.startsWith(afterBracket));
}

export function findIncompleteTagPrefix(text: string): number {
  for (let i = text.lastIndexOf("<"); i >= 0; i = text.lastIndexOf("<", i - 1)) {
    if (isReasoningTagPrefix(text.slice(i))) {
      return i;
    }
  }
  return -1;
}
