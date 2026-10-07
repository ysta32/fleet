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
  return clean(value).match(/^(t?\d+)(?:-[\w-]+)?(?:\.md)?$/i)?.[1];
}

function canonical(id: string): string {
  return id.toLowerCase().replace(/^t/, '');
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

function listedIds(text: string): string[] {
  const ids: string[] = [];
  for (const item of text.split(',')) {
    let remaining = item.trim();
    while (remaining) {
      const match = remaining.match(/^(?:orch-task\/)?(t?\d+)(?![\w:.#-])/i);
      if (!match) break;
      const rest = remaining.slice(match[0].length);
      if (/^\s+tasks?\b/i.test(rest)) break;
      ids.push(canonical(match[1]));
      if (!/^\s/.test(rest)) break;
      remaining = rest.trimStart();
    }
  }
  return ids;
}

function mentions(text: string, id: string, state: 'landed' | 'blocked' | 'running'): boolean {
  for (const clause of clean(text).split(/[;\r\n]/)) {
    const markers = [
      ...clause.matchAll(/\b(landed|merged|blocked|in flight|inflight|queued|running|next|pending)\b/gi),
    ];
    for (const [index, marker] of markers.entries()) {
      const name = marker[1].toLowerCase();
      if (
        name !== state &&
        !(state === 'landed' && name === 'merged') &&
        !(state === 'running' && (name === 'in flight' || name === 'inflight'))
      )
        continue;
      const after = clause
        .slice(marker.index + marker[0].length, markers[index + 1]?.index)
        .replace(/^\s*:?\s*/, '');
      if (listedIds(after).includes(canonical(id))) return true;
      if (index === 0) {
        const before = clause.slice(0, marker.index).replace(/^\s*[-+]\s+/, '');
        if (listedIds(before).includes(canonical(id))) return true;
      }
    }
  }
  return false;
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
  const inflight = parseInflight(inflightText).filter((entry) => !mentions(stateText, entry.task, 'landed'));
  const tasks: OrchTask[] = [];
  for (const file of taskFiles.sort((a, b) => a.name.localeCompare(b.name))) {
    const match = file.name.match(/^(t?\d+)-(.+)\.md$/i);
    if (!file.isFile() || !match) continue;
    const [, id, slug] = match;
    const text = await optionalText(path.join(root, 'TASKS', file.name));
    const risk = metadata(text, 'RISK')?.toLowerCase();
    tasks.push({
      id,
      slug,
      depends: (metadata(text, 'DEPENDS') ?? '')
        .split(/[,\s]+/)
        .map(taskId)
        .filter((value): value is string => value !== undefined),
      route: metadata(text, 'ROUTE'),
      risk: risk === 'low' || risk === 'normal' || risk === 'high' ? risk : undefined,
      state: mentions(stateText, id, 'landed')
        ? 'landed'
        : mentions(stateText, id, 'blocked')
          ? 'blocked'
          : inflight.some((entry) => canonical(entry.task) === canonical(id)) ||
              mentions(stateText, id, 'running')
            ? 'running'
            : 'queued',
    });
  }
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
