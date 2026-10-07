import { appendFile, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { projectIdFromPath, type FleetConfig, type FleetEvent, type FleetSnapshot } from '@fleet/shared';
import { runDaemon, type Daemon } from './daemon.js';

/* Synthetic transcripts only; HOME is a temp dir for the whole file. */

const iso = (ms: number): string => new Date(ms).toISOString();
const usage = {
  input_tokens: 100,
  output_tokens: 50,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

function userLine(at: number, cwd: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'user',
    timestamp: iso(at),
    cwd,
    gitBranch: 'main',
    message: { role: 'user', content: 'synthetic prompt' },
    ...extra,
  });
}

function assistantLine(
  at: number,
  cwd: string,
  id: string,
  content: unknown[],
  stop: string | null = null,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: iso(at),
    cwd,
    gitBranch: 'main',
    message: { id, model: 'claude-opus-4-1', role: 'assistant', stop_reason: stop, content, usage },
    ...extra,
  });
}

const config = (over: Partial<FleetConfig>): FleetConfig => ({
  port: 0,
  lan: false,
  token: 'test-token-0123456789',
  claudeProjectsDir: '/nonexistent',
  recentWindowMs: 24 * 3600_000,
  shareContent: false,
  notify: { macos: false, ntfyUrl: '', kinds: ['session.waiting'] },
  github: false,
  githubPollMs: 60_000,
  ...over,
});

function getJson<T>(port: number, p: string): Promise<T> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: p }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body) as T);
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

async function waitFor<T>(fn: () => Promise<T | undefined> | T | undefined, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined && v !== false) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** SSE client collecting `fleet` events */
function openStream(port: number): { events: FleetEvent[]; ended: Promise<void>; close(): void } {
  const events: FleetEvent[] = [];
  let req!: http.ClientRequest;
  const ended = new Promise<void>((resolve) => {
    req = http.get({ host: '127.0.0.1', port, path: '/api/events' }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => {
        buf += c;
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (!block.startsWith('event: fleet\n')) continue;
          const data = block.split('\n').find((l) => l.startsWith('data: '));
          if (data) events.push(JSON.parse(data.slice(6)) as FleetEvent);
        }
      });
      res.on('close', () => resolve());
      res.on('error', () => resolve());
    });
    req.on('error', () => resolve());
  });
  return { events, ended, close: () => req.destroy() };
}

let tmp: string;
let home: string;
const savedHome = process.env.HOME;
const savedDemo = process.env.FLEET_DEMO;

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(path.join(tmpdir(), 'fleet-daemon-')));
  home = path.join(tmp, 'home');
  await mkdir(home);
  process.env.HOME = home;
  delete process.env.FLEET_DEMO;
});

afterAll(async () => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedDemo !== undefined) process.env.FLEET_DEMO = savedDemo;
  await rm(tmp, { recursive: true, force: true });
});

describe('runDaemon (real sources, synthetic data)', () => {
  let d: Daemon;
  let proj: string;
  let claude: string;
  let dataDir: string;
  let mainFile: string;
  let projectId: string;
  const now = Date.now();

  beforeAll(async () => {
    proj = path.join(tmp, 'proj');
    claude = path.join(tmp, 'claude', 'projects');
    dataDir = path.join(tmp, 'data');
    projectId = projectIdFromPath(proj);
    await mkdir(path.join(proj, '.orch', 'TASKS'), { recursive: true });
    await mkdir(path.join(proj, '.orch', 'wt', 't01'), { recursive: true });
    await writeFile(path.join(proj, '.orch', 'ACTIVE'), '');
    await writeFile(path.join(proj, '.orch', 'STATUS.md'), 'synthetic status\n');
    await writeFile(path.join(proj, '.orch', 'TASKS', '01-alpha.md'), 'DEPENDS: -\nRISK: normal\n');
    await writeFile(path.join(proj, '.orch', 'TASKS', '02-beta.md'), 'DEPENDS: 01\nRISK: low\n');

    const dir = path.join(claude, 'synthetic-proj');
    await mkdir(path.join(dir, 'sess-1', 'subagents'), { recursive: true });
    mainFile = path.join(dir, 'sess-1.jsonl');
    await writeFile(
      mainFile,
      [
        userLine(now - 5000, proj),
        assistantLine(now - 4000, proj, 'msg-1', [
          { type: 'tool_use', id: 'tu-1', name: 'Agent', input: { subagent_type: 'orch-coder' } },
        ]),
      ].join('\n') + '\n',
    );
    const wt = path.join(proj, '.orch', 'wt', 't01');
    await writeFile(
      path.join(dir, 'sess-1', 'subagents', 'agent-abc.jsonl'),
      [
        userLine(now - 3500, wt, { isSidechain: true, agentType: 'orch-coder' }),
        assistantLine(now - 3000, wt, 'msg-sub-1', [{ type: 'text', text: 'synthetic' }], null, {
          isSidechain: true,
        }),
      ].join('\n') + '\n',
    );
    // ended its turn 29s ago: becomes "waiting" (30s) only through the idle clock tick
    await writeFile(
      path.join(dir, 'sess-2.jsonl'),
      [
        userLine(now - 29_500, proj),
        assistantLine(now - 29_000, proj, 'msg-2', [{ type: 'text', text: 'done' }], 'end_turn'),
      ].join('\n') + '\n',
    );

    d = await runDaemon(config({ claudeProjectsDir: claude, digestDir: path.join(tmp, 'digest') }), {
      dataDir,
      tickMs: 200,
      orchMs: 200,
      tailPollMs: 100,
      notifierDeps: { exec: () => undefined },
    });
  });

  afterAll(async () => {
    await d?.close();
  });

  it('binds loopback on an ephemeral port', () => {
    expect(d.host).toBe('127.0.0.1');
    expect(d.port).toBeGreaterThan(0);
  });

  it('serves project, session, orch tasks and folds the subagent into its parent', async () => {
    const snap = await waitFor(async () => {
      const s = await getJson<FleetSnapshot>(d.port, '/api/snapshot');
      const p = s.projects.find((x) => x.id === projectId);
      const sess = s.sessions.find((x) => x.id === 'sess-1');
      return p?.orch && sess?.agentIds.includes('sess-1:abc') ? s : undefined;
    });
    const p = snap.projects.find((x) => x.id === projectId)!;
    expect(p.name).toBe('proj');
    expect(p.path).toBe(proj);
    expect(p.orch!.tasks.map((t) => t.id)).toEqual(['01', '02']);
    expect(p.orch!.worktrees).toEqual(['t01']);
    // worktree cwd resolves to the same project, not a separate one
    expect(snap.projects.filter((x) => x.path.includes('.orch'))).toEqual([]);

    const sess = snap.sessions.find((x) => x.id === 'sess-1')!;
    expect(sess.projectId).toBe(projectId);
    expect(sess.agentIds).toEqual(['sess-1', 'sess-1:abc']);
    // lead msg-1 + subagent msg-sub-1, folded
    expect(sess.tokens.input).toBe(200);
    expect(sess.tokens.output).toBe(100);
    expect(sess.costUsd).toBeGreaterThan(0);
    // subagent transcripts never become sessions of their own
    expect(snap.sessions.map((s) => s.id).sort()).toEqual(['sess-1', 'sess-2']);

    const sub = snap.agents.find((a) => a.id === 'sess-1:abc')!;
    expect(sub.sessionId).toBe('sess-1');
    expect(sub.projectId).toBe(projectId);
    expect(sub.location).toEqual({ kind: 'worktree', projectId, ref: 't01' });
  });

  it('streams an appended transcript line as an SSE event and updates the snapshot', async () => {
    const stream = openStream(d.port);
    try {
      await new Promise((r) => setTimeout(r, 200));
      const at = Date.now();
      await appendFile(
        mainFile,
        assistantLine(at, proj, 'msg-3', [
          { type: 'tool_use', id: 'tu-3', name: 'Edit', input: { file_path: '/x/synthetic-file.ts' } },
        ]) + '\n',
      );
      const e = await waitFor(() =>
        stream.events.find((x) => x.kind === 'agent.tool' && x.sessionId === 'sess-1' && x.ts === at),
      );
      expect(e.projectId).toBe(projectId);
      const snap = await waitFor(async () => {
        const s = await getJson<FleetSnapshot>(d.port, '/api/snapshot');
        return s.sessions.find((x) => x.id === 'sess-1')?.lastActivity === at ? s : undefined;
      });
      expect(snap.sessions.find((x) => x.id === 'sess-1')!.lastTool?.name).toBe('Edit');
    } finally {
      stream.close();
    }
  });

  it('advances idle sessions to waiting via the clock tick and raises an alert', async () => {
    const snap = await waitFor(async () => {
      const s = await getJson<FleetSnapshot>(d.port, '/api/snapshot');
      return s.sessions.find((x) => x.id === 'sess-2')?.status === 'waiting' ? s : undefined;
    });
    expect(snap.agents.find((a) => a.id === 'sess-2')?.status).toBe('waiting');
    const withAlert = await waitFor(async () => {
      const s = await getJson<FleetSnapshot>(d.port, '/api/snapshot');
      return s.alerts.some((a) => a.kind === 'session.waiting') ? s : undefined;
    });
    expect(withAlert.alerts.find((a) => a.kind === 'session.waiting')!.projectId).toBe(projectId);
  });

  it('has no spend route when fleet-spend is absent', async () => {
    const r = await getJson<{ error?: string }>(d.port, '/api/spend');
    expect(r.error).toBeDefined();
  });

  it('shuts down cleanly: closes streams, stops listening, writes history', async () => {
    const stream = openStream(d.port);
    await new Promise((r) => setTimeout(r, 100));
    const p1 = d.close();
    const p2 = d.close();
    expect(p2).toBe(p1);
    await p1;
    await stream.ended;
    expect(d.server.listening).toBe(false);
    expect(existsSync(path.join(dataDir, 'history.json'))).toBe(true);
    await expect(getJson(d.port, '/api/health')).rejects.toThrow();
    // nothing was written into the observed project or transcript dirs
    expect((await readdir(path.join(proj, '.orch'))).sort()).toEqual(['ACTIVE', 'STATUS.md', 'TASKS', 'wt']);
    expect((await readdir(path.join(claude, 'synthetic-proj'))).sort()).toEqual([
      'sess-1',
      'sess-1.jsonl',
      'sess-2.jsonl',
    ]);
  });
});

describe('runDaemon demo mode', () => {
  it('serves synthetic data and touches no HOME or transcript paths', async () => {
    const demoHome = path.join(tmp, 'demo-home');
    await mkdir(demoHome);
    process.env.HOME = demoHome;
    const claude = path.join(tmp, 'demo-claude');
    const dir = path.join(claude, 'synthetic-proj');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'sess-real.jsonl'), userLine(Date.now(), path.join(tmp, 'proj')) + '\n');
    try {
      const d = await runDaemon(config({ claudeProjectsDir: claude }), { demo: true, demoTickMs: 50 });
      try {
        const snap = await getJson<FleetSnapshot>(d.port, '/api/snapshot');
        expect(snap.demo).toBe(true);
        expect(snap.projects.length).toBeGreaterThan(0);
        expect(snap.projects.every((p) => p.path.startsWith('/synthetic/'))).toBe(true);
        expect(snap.sessions.some((s) => s.id === 'sess-real')).toBe(false);
        expect(snap.spend).toBeUndefined();
        const h = await getJson<{ ok: boolean }>(d.port, '/api/health');
        expect(h.ok).toBe(true);
        await new Promise((r) => setTimeout(r, 200));
      } finally {
        await d.close();
      }
      expect(d.server.listening).toBe(false);
      expect(await readdir(demoHome, { recursive: true })).toEqual([]);
      expect(await readdir(dir)).toEqual(['sess-real.jsonl']);
    } finally {
      process.env.HOME = home;
    }
  });

  it('is selected by FLEET_DEMO=1', async () => {
    process.env.FLEET_DEMO = '1';
    try {
      const d = await runDaemon(config({}));
      try {
        expect(d.snapshot().demo).toBe(true);
      } finally {
        await d.close();
      }
    } finally {
      delete process.env.FLEET_DEMO;
    }
  });
});
