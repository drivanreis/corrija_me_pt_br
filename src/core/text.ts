export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isWordLike(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

export function createWholeWordPattern(term: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, "giu");
}

export function preserveReplacementCase(original: string, replacement: string): string {
  if (!replacement) {
    return replacement;
  }

  if (original === original.toUpperCase() && /[\p{L}]/u.test(original)) {
    return replacement.toUpperCase();
  }

  if (original[0] && original[0] === original[0].toUpperCase() && original.slice(1) === original.slice(1).toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }

  return replacement;
}

export function buildContext(text: string, offset: number, length: number): { text: string; offset: number; length: number } {
  const start = Math.max(0, offset - 25);
  const end = Math.min(text.length, offset + length + 25);
  return {
    text: text.slice(start, end),
    offset: offset - start,
    length
  };
}

export function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
