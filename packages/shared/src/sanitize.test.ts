import { describe, expect, it } from 'vitest';
import { sanitizeTarget, truncate } from './index.js';

describe('sanitizeTarget', () => {
  it.each(['Edit', 'Write', 'Read', 'NotebookEdit'])('exposes only the basename for %s', (tool) => {
    expect(
      sanitizeTarget(tool, {
        file_path: '/tmp/synthetic-private/project/example.ts',
        content: 'synthetic-secret',
        old_string: 'synthetic-secret',
        new_string: 'synthetic-secret',
      }),
    ).toBe('example.ts');
    expect(sanitizeTarget(tool, { file_path: 'C:\\private\\example.ts' })).toBe('example.ts');
  });

  it.each([
    ['FOO=secret curl https://x?token=abc', 'curl'],
    ['FOO="synthetic secret" BAR=another /usr/bin/curl https://x?token=abc', 'curl'],
    ["FOO='synthetic secret' /usr/bin/git status", 'git'],
    ['FOO=synthetic\\ secret /usr/bin/git status', 'git'],
    ['  /usr/bin/npm test --token=synthetic-secret', 'npm'],
    ['"/synthetic private/bin/curl" https://x?token=abc', 'curl'],
    ["'/usr/bin/git' status", 'git'],
    ['echo synthetic-secret; curl https://x?token=abc', 'echo'],
    ['git|cat', 'git'],
    ['FOO=synthetic-secret', undefined],
    ['FOO=$(echo synthetic-secret) curl https://x', undefined],
    ['FOO=`echo synthetic-secret` curl https://x', undefined],
    ['FOO="$(echo synthetic-secret)" curl https://x', undefined],
    ['$SYNTHETIC_SECRET arg', undefined],
    ['$(echo synthetic-secret)', undefined],
    ['"unterminated synthetic-secret', undefined],
    ['', undefined],
    ['   ', undefined],
  ])('sanitizes Bash input %s', (command, target) => {
    expect(sanitizeTarget('Bash', { command })).toBe(target);
  });

  it.each(['Grep', 'Glob'])('hides the pattern for %s', (tool) => {
    expect(sanitizeTarget(tool, { pattern: 'synthetic-secret', path: '/private' })).toBe('search');
  });

  it.each(['Agent', 'Task'])('uses only subagent_type for %s', (tool) => {
    expect(sanitizeTarget(tool, { subagent_type: 'orch-coder', prompt: 'synthetic-secret' })).toBe(
      'orch-coder',
    );
  });

  it('hides URL credentials, port, path, query and fragment', () => {
    expect(
      sanitizeTarget('WebFetch', {
        url: 'https://synthetic:secret@example.test:4500/private?token=abc#secret',
        prompt: 'synthetic-secret',
      }),
    ).toBe('example.test');
    expect(sanitizeTarget('WebFetch', { url: 'not a URL' })).toBeUndefined();
    expect(sanitizeTarget('WebFetch', { url: 'file:///synthetic/private' })).toBeUndefined();
  });

  it('uses only the skill name', () => {
    expect(sanitizeTarget('Skill', { skill: 'synthetic-skill', args: 'synthetic-secret' })).toBe(
      'synthetic-skill',
    );
  });

  describe.each([
    ['Agent', 'subagent_type'],
    ['Task', 'subagent_type'],
    ['Skill', 'skill'],
  ])('%s label validation', (tool, field) => {
    it.each(['a', 'AZaz09_.:-', 'a'.repeat(60)])('preserves valid label %j', (label) => {
      expect(sanitizeTarget(tool, { [field]: label })).toBe(label);
    });

    it.each([
      '',
      'a'.repeat(61),
      'a'.repeat(100),
      'synthetic label',
      ' label',
      'label ',
      'label\n',
      'label\r',
      'label\t',
      'label\u0000',
      'label\u2028',
      'label\u2029',
      'synthetic/label',
      'synthetic\\label',
      'label@synthetic',
      'label+synthetic',
      'caf\u00e9',
      null,
      undefined,
      42,
      [],
      {},
    ])('rejects invalid label %j', (label) => {
      expect(sanitizeTarget(tool, { [field]: label })).toBeUndefined();
    });
  });

  it('truncates file, command and hostname labels to 60 characters', () => {
    const long = 'a'.repeat(100);
    for (const [tool, input] of [
      ['Read', { file_path: `/tmp/${long}` }],
      ['Bash', { command: `${long} secret` }],
      ['WebFetch', { url: `https://${'a'.repeat(50)}.${'b'.repeat(50)}.test` }],
    ] as const) {
      expect(sanitizeTarget(tool, input)).toHaveLength(60);
    }
  });

  it.each([null, undefined, 'synthetic-secret', 42, [], {}])(
    'handles missing or malformed input %s',
    (input) => {
      expect(sanitizeTarget('Read', input)).toBeUndefined();
      expect(sanitizeTarget('Bash', input)).toBeUndefined();
    },
  );

  it('ignores unknown tools and nonstring fields', () => {
    expect(sanitizeTarget('Other', { command: 'secret', file_path: 'secret' })).toBeUndefined();
    for (const tool of ['Read', 'Bash', 'Agent', 'WebFetch', 'Skill']) {
      expect(
        sanitizeTarget(tool, { file_path: 1, command: {}, subagent_type: [], url: false, skill: null }),
      ).toBeUndefined();
    }
  });
});

describe('truncate', () => {
  it('bounds strings without padding or exceeding the limit', () => {
    expect(truncate('abcdef', 3)).toBe('abc');
    expect(truncate('abc', 5)).toBe('abc');
    expect(truncate('abc', 0)).toBe('');
    expect(truncate('abc', -1)).toBe('');
    expect(truncate('', 5)).toBe('');
  });
});
