const RESET = "\x1b[0m";

export function bold(text: string): string {
  return `\x1b[1m${text}${RESET}`;
}

export function dim(text: string): string {
  return `\x1b[2m${text}${RESET}`;
}

export function italic(text: string): string {
  return `\x1b[3m${text}${RESET}`;
}

export function underline(text: string): string {
  return `\x1b[4m${text}${RESET}`;
}

export function strikethrough(text: string): string {
  return `\x1b[9m${text}${RESET}`;
}

export function black(text: string): string {
  return `\x1b[30m${text}${RESET}`;
}

export function red(text: string): string {
  return `\x1b[31m${text}${RESET}`;
}

export function green(text: string): string {
  return `\x1b[32m${text}${RESET}`;
}

export function yellow(text: string): string {
  return `\x1b[33m${text}${RESET}`;
}

export function blue(text: string): string {
  return `\x1b[34m${text}${RESET}`;
}

export function magenta(text: string): string {
  return `\x1b[35m${text}${RESET}`;
}

export function cyan(text: string): string {
  return `\x1b[36m${text}${RESET}`;
}

export function white(text: string): string {
  return `\x1b[37m${text}${RESET}`;
}

export function bgBlue(text: string): string {
  return `\x1b[44m${text}${RESET}`;
}

export function bgGray(text: string): string {
  return `\x1b[48;5;240m${text}${RESET}`;
}
