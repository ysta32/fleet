import { describe, expect, it } from 'vitest';
import { csvNumber, csvRows, parseCsv } from './csv.js';

describe('parseCsv', () => {
  it('handles quoted commas, escaped quotes, embedded CRLF and trailing empty fields', () => {
    expect(parseCsv('a,b,c\r\n"one,two","say ""hi""","line\r\nbreak"\r\nx,y,')).toEqual([
      ['a', 'b', 'c'],
      ['one,two', 'say "hi"', 'line\r\nbreak'],
      ['x', 'y', ''],
    ]);
  });
  it('handles BOM, blank lines, normalized headers, and short rows', () => {
    expect(csvRows('\uFEFF Date ,MODEL,Cost\r\n\r\n2026-10-01,gpt-test\r\n')).toEqual([
      { date: '2026-10-01', model: 'gpt-test', cost: '' },
    ]);
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('a\nb\n')).toEqual([['a'], ['b']]);
  });
  it.each(['a\n"unfinished', 'a\n"closed"junk', 'a\nun"quoted'])('rejects malformed quoting: %s', (input) => {
    expect(() => parseCsv(input)).toThrow();
  });
  it('parses finite amounts without treating blanks or labels as zero', () => {
    expect(csvNumber('$1,234.50')).toBe(1234.5);
    expect(csvNumber('0')).toBe(0);
    expect(csvNumber('-2.50')).toBe(-2.5);
    for (const value of ['', 'Included', 'Infinity', 'NaN', '1,2', '0x10', '2 USD']) {
      expect(csvNumber(value)).toBeUndefined();
    }
  });
});
