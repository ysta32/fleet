import { createHash } from 'node:crypto';

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closed = false;
  const input = text.replace(/^\uFEFF/, '');
  const endField = (): void => {
    row.push(field);
    field = '';
    closed = false;
  };
  const endRow = (): void => {
    endField();
    if (row.some((value) => value.trim() !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        field += char;
      }
    } else if (char === ',') {
      endField();
    } else if (char === '\r' || char === '\n') {
      endRow();
      if (char === '\r' && input[i + 1] === '\n') i++;
    } else if (char === '"' && field === '' && !closed) {
      quoted = true;
    } else {
      if (closed || char === '"') throw new Error('Invalid CSV quoting');
      field += char;
    }
  }
  if (quoted) throw new Error('Unterminated CSV field');
  if (field !== '' || row.length > 0 || closed) endRow();
  return rows;
}

export function csvRows(text: string): Record<string, string>[] {
  const [headers, ...rows] = parseCsv(text);
  if (!headers) return [];
  return rows.map((row) =>
    Object.fromEntries(headers.map((header, i) => [header.trim().toLowerCase(), row[i]?.trim() ?? ''])),
  );
}

export function csvNumber(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.trim().replace(/^\$\s*/, '');
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(normalized)) return undefined;
  const number = Number(normalized.replaceAll(',', ''));
  return Number.isFinite(number) ? number : undefined;
}

export function csvId(source: string, row: Record<string, string>, seen: Map<string, number>): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(Object.entries(row).sort()))
    .digest('hex');
  const occurrence = seen.get(hash) ?? 0;
  seen.set(hash, occurrence + 1);
  return `${source}:${hash}:${occurrence}`;
}

export function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
