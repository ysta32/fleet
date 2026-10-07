import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import type { FleetEvent, InflightEntry, OrchRun, OrchTask } from '@fleet/shared';

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function optionalText(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (missing(error)) return '';
    throw error;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

async function entries(directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
}

function clean(value: string): string {
  return value.replace(/[`*]/g, '').trim();
}

function taskId(value: string): string | undefined {
  return clean(value).match(/^([a-z]?\d+[a-z]?)(?:-[\w-]+)?(?:\.md)?$/i)?.[1];
}

function canonical(id: string): string {
  return id.toLowerCase().replace(/^t(?=\d)/, '');
}

function parseInflight(text: string): InflightEntry[] {
  const result: InflightEntry[] = [];
  let headers: string[] | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('|')) continue;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(clean);
    const names = cells.map((cell) => cell.toLowerCase().replace(/[ _-]/g, ''));
    if (names.some((name) => name === 'task' || name === 'taskid')) {
      headers = names;
      continue;
    }
    const field = (aliases: string[], fallback: number): string => {
      const index = headers ? headers.findIndex((name) => aliases.includes(name)) : fallback;
      return index < 0 ? '' : (cells[index] ?? '');
    };
    const task = taskId(field(['task', 'taskid'], 0));
    if (!task) continue;
    const started =
      field(['started', 'start', 'time', 'hh:mm'], 5) ||
      cells.find((cell) => /^\d{2}:\d{2}$/.test(cell)) ||
      '';
    const base = field(['base', 'basesha', 'sha'], 4);
    result.push({
      task,
      role: field(['role'], 1),
      agent: field(['agent', 'agentid'], 2),
      worktree: field(['worktree', 'wt'], 3),
      baseSha: /^\d{2}:\d{2}$/.test(base) ? '' : base,
      started,
    });
  }
  return result;
}

function metadata(text: string, key: string): string | undefined {
  const match = text.match(
    new RegExp(`^[\\t ]*(?:-[\\t ]*)?(?:\\*\\*)?${key}(?:\\*\\*)?:[\\t ]*(.*)$`, 'im'),
  );
  const value = match ? clean(match[1]) : '';
  return value && value !== '-' ? value : undefined;
}

type Mark = 'landed' | 'blocked' | 'running' | 'queued' | 'none';

const MARKERS: Record<string, Mark> = {
  landed: 'landed',
  merged: 'landed',
  done: 'landed',
  blocked: 'blocked',
  inflight: 'running',
  'in-flight': 'running',
  running: 'running',
  queued: 'queued',
  next: 'none',
  pending: 'none',
};
const TWO_WORD_MARKERS: Record<string, Mark> = { flight: 'running', review: 'running' };
const UNIT =
  /^(?:tasks?|files?|tests?|mins?|minutes?|s|secs?|seconds?|h|hrs?|hours?|ms|%|commits?|lines?|prs?|agents?|rounds?|times|days?|of)$/i;
const ID_PATTERN = /^([a-z]?)(\d{1,3})([a-z]?)$/i;
const RANGE_PATTERN = /^([a-z]?)(\d{1,3})-([a-z]?)(\d{1,3})$/i;
const MAX_RANGE = 50;

interface Token {
  kind: 'space' | 'sep' | 'paren' | 'word';
  text: string;
}

function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  for (const match of line.matchAll(/(\s+)|([,;+&])|\(([^()]*)\)|([^\s,;+&()]+)|([()])/g)) {
    if (match[1] !== undefined) tokens.push({ kind: 'space', text: match[1] });
    else if (match[2] !== undefined) tokens.push({ kind: 'sep', text: match[2] });
    else if (match[3] !== undefined) tokens.push({ kind: 'paren', text: match[3] });
    else tokens.push({ kind: 'word', text: match[4] ?? match[5] });
  }
  return tokens;
}

function normalWord(token: Token | undefined): string {
  return token?.kind === 'word' ? token.text.toLowerCase().replace(/[:.]+$/, '') : '';
}

function nextSolid(tokens: Token[], index: number): number {
  let cursor = index;
  while (tokens[cursor]?.kind === 'space') cursor++;
  return cursor;
}

/** Returns the marker state and the index just past the marker, if a marker starts at `index`. */
function markerAt(tokens: Token[], index: number): { mark: Mark; end: number } | undefined {
  const word = normalWord(tokens[index]);
  if (!word) return undefined;
  if (word in MARKERS) return { mark: MARKERS[word], end: index + 1 };
  if (word !== 'in' || /[:.]$/.test(tokens[index].text)) return undefined;
  const following = nextSolid(tokens, index + 1);
  const second = normalWord(tokens[following]);
  return second in TWO_WORD_MARKERS ? { mark: TWO_WORD_MARKERS[second], end: following + 1 } : undefined;
}

/** Parses one list item; undefined when the word is not ID-shaped, 'reject' when it looks like a count/range misuse. */
function parseItem(word: string, following: string): string[] | 'reject' | undefined {
  const text = word.replace(/^orch-task\//i, '').replace(/^([a-z]?\d{1,3}[a-z]?):$/i, '$1');
  const single = text.match(ID_PATTERN);
  if (single) {
    if (UNIT.test(following)) return 'reject';
    if (!single[1] && !single[3] && /^0+$/.test(single[2])) return 'reject';
    return [text];
  }
  const range = text.match(RANGE_PATTERN);
  if (!range) return undefined;
  const [, prefix, from, otherPrefix, to] = range;
  if (otherPrefix && otherPrefix.toLowerCase() !== prefix.toLowerCase()) return 'reject';
  const start = Number(from);
  const stop = Number(to);
  if (stop <= start || stop - start > MAX_RANGE || UNIT.test(following)) return 'reject';
  return Array.from(
    { length: stop - start + 1 },
    (_, offset) => `${prefix}${String(start + offset).padStart(from.length, '0')}`,
  );
}

/**
 * Consumes a list of task IDs. Items are separated by `,`, `+`, `&` or whitespace; an item is an ID
 * or numeric range optionally followed by descriptive words up to the next separator. The list ends
 * at a non-ID where an item is expected, a rejected number (time, count, version, sha), or a sentence end.
 */
function parseList(tokens: Token[], header: boolean): string[] {
  const ids: string[] = [];
  let index = nextSolid(tokens, 0);
  if (header) {
    let cursor = index;
    let words = 0;
    let found = -1;
    while (cursor < tokens.length) {
      const token = tokens[cursor];
      if (token.kind === 'space') {
        cursor++;
        continue;
      }
      if (token.kind === 'word' && (token.text === ':' || /^[a-z][a-z-]*:$/i.test(token.text))) {
        found = cursor;
        break;
      }
      if (
        words < 4 &&
        (token.kind === 'paren' || (token.kind === 'word' && /^[a-z][a-z-]*$/i.test(token.text)))
      ) {
        words++;
        cursor++;
        continue;
      }
      break;
    }
    if (found >= 0) {
      index = found + 1;
    } else if (tokens[index]?.kind === 'paren') {
      ids.push(...parseList(tokenize(tokens[index].text), false));
      index = nextSolid(tokens, index + 1);
      if (tokens[index]?.kind === 'word' && tokens[index].text === ':') index++;
    }
  }
  let mode: 'expect' | 'after' | 'describe' = 'expect';
  for (; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind === 'space') continue;
    if (token.kind === 'sep') {
      if (token.text === ';') break;
      mode = 'expect';
      continue;
    }
    if (token.kind === 'paren') {
      mode = 'describe';
      continue;
    }
    const sentenceEnd = /[^.]\.+$/.test(token.text) || token.text === '.';
    const word = sentenceEnd ? token.text.replace(/\.+$/, '') : token.text;
    if (mode !== 'describe') {
      const item = parseItem(word, normalWord(tokens[nextSolid(tokens, index + 1)]));
      if (Array.isArray(item)) {
        ids.push(...item);
        mode = 'after';
      } else if (mode === 'expect') {
        break;
      } else {
        mode = 'describe';
      }
    }
    if (sentenceEnd) break;
  }
  return ids;
}

/** Collects text-declared states per canonical task ID from STATUS/HANDOFF text. */
function textStates(text: string): Map<string, Set<Mark>> {
  const states = new Map<string, Set<Mark>>();
  const add = (ids: string[], mark: Mark): void => {
    if (mark === 'none') return;
    for (const id of ids) {
      const key = canonical(id);
      states.set(key, (states.get(key) ?? new Set<Mark>()).add(mark));
    }
  };
  for (const line of clean(text).split(/\r?\n/)) {
    const tokens = tokenize(line);
    let clauseStart = 0;
    for (let index = 0; index <= tokens.length; index++) {
      const token = tokens[index];
      if (token && !(token.kind === 'sep' && token.text === ';')) continue;
      const clause = tokens.slice(clauseStart, index);
      clauseStart = index + 1;
      const markers: { mark: Mark; start: number; end: number }[] = [];
      for (let cursor = 0; cursor < clause.length; cursor++) {
        const marker = markerAt(clause, cursor);
        if (!marker) continue;
        markers.push({ mark: marker.mark, start: cursor, end: marker.end });
        cursor = marker.end - 1;
      }
      for (const [position, marker] of markers.entries()) {
        add(parseList(clause.slice(marker.end, markers[position + 1]?.start), true), marker.mark);
        if (position > 0) continue;
        const prefix = clause.slice(0, marker.start);
        const first = nextSolid(prefix, 0);
        if (prefix[first]?.kind === 'word' && /^[-*#>]+$/.test(prefix[first].text))
          prefix.splice(0, first + 1);
        add(parseList(prefix, false), marker.mark);
      }
    }
  }
  return states;
}

const GIT_TIMEOUT_MS = 3000;
const gitWorkCache = new Map<string, boolean>();

function git(projectPath: string, args: string[]): Promise<string | undefined> {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY'])
    delete env[name];
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', projectPath, ...args],
      { env, timeout: GIT_TIMEOUT_MS, maxBuffer: 1 << 20, windowsHide: true },
      (error, stdout) => resolve(error ? undefined : stdout.trim()),
    );
  });
}

async function runBranch(projectPath: string, stateText: string): Promise<string | undefined> {
  const named = stateText.match(/\bbranch\s+(orch\/[\w./-]+)/i)?.[1].replace(/[./-]+$/, '');
  if (named && (await git(projectPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${named}^{commit}`])))
    return `refs/heads/${named}`;
  const head = await git(projectPath, ['symbolic-ref', '--quiet', 'HEAD']);
  if (head?.startsWith('refs/heads/')) return head;
  return (await git(projectPath, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])) ? 'HEAD' : undefined;
}

/** True when the task branch has at least one commit beyond the commit it was created from. */
async function hasWork(
  projectPath: string,
  ref: string,
  tip: string,
  base: string | undefined,
): Promise<boolean> {
  const key = `${projectPath}\0${ref}\0${tip}`;
  const cached = gitWorkCache.get(key);
  if (cached !== undefined) return cached;
  const reflog = await git(projectPath, ['reflog', 'show', '--format=%H', ref, '--']);
  const fork =
    reflog?.split('\n').filter(Boolean).at(-1) ?? (base && /^[0-9a-f]{7,40}$/i.test(base) ? base : undefined);
  if (!fork) return false;
  const count = await git(projectPath, ['rev-list', '--count', `${fork}..${tip}`, '--']);
  if (count === undefined) return false;
  const result = Number(count) > 0;
  if (gitWorkCache.size > 5000) gitWorkCache.clear();
  gitWorkCache.set(key, result);
  return result;
}

/** Maps a branch suffix (tNN, NN, D2...) to a task ID: exact canonical match first, then numeric without leading zeros. */
function branchTask(suffix: string, ids: string[]): string | undefined {
  const wanted = canonical(suffix);
  const exact = ids.find((id) => canonical(id) === wanted);
  if (exact) return exact;
  const loose = (id: string): string => canonical(id).replace(/^([a-z]?)0+(?=\d)/, '$1');
  const matches = ids.filter((id) => loose(id) === loose(suffix));
  return matches.length === 1 ? matches[0] : undefined;
}

/** Read-only git signal: task branches merged into the run branch with real work on them. */
async function gitLanded(
  projectPath: string,
  stateText: string,
  ids: string[],
  inflight: InflightEntry[],
): Promise<Set<string>> {
  const landed = new Set<string>();
  if (!ids.length) return landed;
  const run = await runBranch(projectPath, stateText);
  if (!run) return landed;
  const merged = await git(projectPath, [
    'for-each-ref',
    `--merged=${run}`,
    '--format=%(refname)%09%(objectname)',
    'refs/heads/orch-task/',
  ]);
  if (!merged) return landed;
  await Promise.all(
    merged.split('\n').map(async (line) => {
      const [ref, tip] = line.split('\t');
      if (!ref || !tip) return;
      const id = branchTask(ref.slice('refs/heads/orch-task/'.length), ids);
      if (!id) return;
      const base = inflight.find((entry) => canonical(entry.task) === canonical(id))?.baseSha;
      if (await hasWork(projectPath, ref, tip, base)) landed.add(canonical(id));
    }),
  );
  return landed;
}

export async function readOrchRun(projectPath: string, projectId: string): Promise<OrchRun | undefined> {
  const root = path.join(projectPath, '.orch');
  if (!(await exists(root))) return undefined;
  const [status, handoff, inflightText, taskFiles, worktreeFiles, active, report] = await Promise.all([
    optionalText(path.join(root, 'STATUS.md')),
    optionalText(path.join(root, 'HANDOFF.md')),
    optionalText(path.join(root, 'INFLIGHT.md')),
    entries(path.join(root, 'TASKS')),
    entries(path.join(root, 'wt')),
    exists(path.join(root, 'ACTIVE')),
    exists(path.join(root, 'REPORT.md')),
  ]);
  const stateText = `${status}\n${handoff}`;
  const files: { id: string; slug: string; text: string }[] = [];
  for (const file of taskFiles.sort((a, b) => a.name.localeCompare(b.name))) {
    const match = file.name.match(/^([a-z]?\d{1,4}[a-z]?)-(.+)\.md$/i);
    if (!file.isFile() || !match) continue;
    files.push({
      id: match[1],
      slug: match[2],
      text: await optionalText(path.join(root, 'TASKS', file.name)),
    });
  }
  const declared = textStates(stateText);
  const parsedInflight = parseInflight(inflightText);
  const merged = await gitLanded(
    projectPath,
    stateText,
    files.map((file) => file.id),
    parsedInflight,
  );
  const has = (id: string, mark: Mark): boolean => declared.get(canonical(id))?.has(mark) ?? false;
  const landed = (id: string): boolean => merged.has(canonical(id)) || has(id, 'landed');
  const inflight = parsedInflight.filter((entry) => !landed(entry.task));
  const tasks: OrchTask[] = files.map(({ id, slug, text }) => {
    const risk = metadata(text, 'RISK')?.toLowerCase();
    return {
      id,
      slug,
      depends: (metadata(text, 'DEPENDS') ?? '')
        .split(/[,\s]+/)
        .map(taskId)
        .filter((value): value is string => value !== undefined),
      route: metadata(text, 'ROUTE'),
      risk: risk === 'low' || risk === 'normal' || risk === 'high' ? risk : undefined,
      state: landed(id)
        ? 'landed'
        : has(id, 'blocked')
          ? 'blocked'
          : inflight.some((entry) => canonical(entry.task) === canonical(id)) || has(id, 'running')
            ? 'running'
            : 'queued',
    };
  });
  const blocked = tasks.filter((task) => task.state === 'blocked').map((task) => task.id);
  return {
    projectId,
    phase:
      report && !active
        ? 'done'
        : blocked.length && !inflight.length
          ? 'blocked'
          : active
            ? 'running'
            : 'idle',
    statusText: status.split(/\r?\n/).slice(0, 12).join('\n'),
    handoffText: handoff.split(/\r?\n/).slice(0, 10).join('\n'),
    tasks,
    inflight,
    worktrees: worktreeFiles
      .filter((file) => file.isDirectory())
      .map((file) => file.name)
      .sort(),
    blocked,
    updatedAt: Date.now(),
  };
}

let eventSequence = 0;

export function diffOrch(prev: OrchRun | undefined, next: OrchRun, now: number): FleetEvent[] {
  const events: FleetEvent[] = [];
  const emit = (event: Omit<FleetEvent, 'id' | 'ts' | 'projectId'>): void => {
    events.push({ ...event, id: `${now}-${eventSequence++}`, ts: now, projectId: next.projectId });
  };
  for (const task of next.tasks) {
    const previous = prev?.tasks.find((candidate) => candidate.id === task.id);
    if (previous?.state === task.state) continue;
    emit({
      kind: 'task.state',
      taskId: task.id,
      severity: task.state === 'landed' ? 'success' : task.state === 'blocked' ? 'warn' : 'info',
      label: `Task ${task.id} ${task.state}`.slice(0, 80),
      data: { state: task.state },
    });
  }
  for (const id of next.blocked) {
    if (prev?.blocked.includes(id)) continue;
    emit({
      kind: 'blocked',
      taskId: id,
      severity: 'warn',
      label: `Task ${id} blocked`.slice(0, 80),
      data: { state: 'blocked' },
    });
  }
  if (next.phase === 'done' && prev?.phase !== 'done') {
    emit({ kind: 'army.done', severity: 'success', label: 'Army done' });
  }
  return events;
}

export function worktreeOf(cwd: string): { projectPath: string; worktreeId: string } | undefined {
  if (!path.isAbsolute(cwd)) return undefined;
  const match = path.normalize(cwd).match(/^(.*)\/\.orch\/wt\/([^/]+)(?:\/.*)?$/);
  return match ? { projectPath: match[1] || '/', worktreeId: match[2] } : undefined;
}
