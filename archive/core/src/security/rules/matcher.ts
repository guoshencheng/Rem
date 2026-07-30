/**
 * Convert a glob-like pattern to a RegExp.
 * Supported: * (any chars except /), ? (single char), ** (any chars including /)
 */
export function patternToRegExp(pattern: string): RegExp {
  let regex = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      // ** matches any characters including /
      // If followed by /, consume it as well to avoid leaving a stray /
      if (pattern[i + 2] === '/') {
        regex += '(?:.*\/)?';
        i += 3;
      } else {
        regex += '.*';
        i += 2;
      }
    } else if (c === '*') {
      regex += '[^/]*';
      i++;
    } else if (c === '?') {
      regex += '[^/]';
      i++;
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      regex += '\\' + c;
      i++;
    } else {
      regex += c;
      i++;
    }
  }
  return new RegExp(`^${regex}$`);
}

export function matchPattern(value: string, pattern: string): boolean {
  return patternToRegExp(pattern).test(value);
}
