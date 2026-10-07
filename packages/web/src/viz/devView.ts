/**
 * DEV ONLY: tiny self-contained synthetic FleetView for developing / screenshotting the visualizer
 * without the real data layer. All names are obviously synthetic. Never reads real data.
 * The real demo generator lives in @fleet/shared (createDemoFleet) once it exists.
 */
import type {
  Agent,
  AgentLocation,
  AgentRole,
  FleetEvent,
  FleetEventKind,
  FleetSnapshot,
  ModelFamily,
  OrchTask,
  OrchTaskState,
  Project,
  PullRequest,
  Session,
  Severity,
} from '@fleet/shared';
import type { FleetView, ReplayControls } from '../data/contract';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = [
  'synth-aurora',
  'synth-quasar',
  'synth-nebula',
  'synth-pulsar',
  'synth-vector',
  'synth-helix',
  'synth-zenith',
];
const MODELS: ModelFamily[] = ['opus', 'sonnet', 'haiku', 'fable', 'astra'];
const ROLES: AgentRole[] = ['coder', 'coder', 'critic', 'scout', 'tester', 'senior'];
const TOOLS = ['Edit', 'Read', 'Bash', 'Grep', 'Write', 'Agent'];
const TARGETS = ['example.ts', 'npm', 'git', 'fixture.json', 'sample.tsx', 'scout'];
const zeroTokens = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

export interface DevFleet {
  view(): FleetView;
  /** notified whenever view() returns a new object (snapshot changed) */
  subscribe(cb: () => void): () => void;
  start(): void;
  stop(): void;
}

export function createDevFleet(opts: { seed?: number; projects?: number; tickMs?: number } = {}): DevFleet {
  const rnd = mulberry32(opts.seed ?? 7);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const nProjects = Math.max(1, Math.min(NAMES.length, opts.projects ?? 5));
  const tickMs = opts.tickMs ?? 450;
  const now0 = Date.now();
  let seq = 0;

  const projects: Project[] = [];
  const sessions: Session[] = [];
  const agents: Agent[] = [];
  const prs: PullRequest[] = [];

  for (let p = 0; p < nProjects; p++) {
    const id = `-synthetic-${NAMES[p]}`;
    const hasOrch = p % 3 !== 2;
    const tasks: OrchTask[] = [];
    if (hasOrch) {
      const nt = 5 + Math.floor(rnd() * 14);
      for (let t = 0; t < nt; t++) {
        const states: OrchTaskState[] = ['queued', 'queued', 'running', 'review', 'landed', 'landed'];
        tasks.push({
          id: String(t + 1).padStart(2, '0'),
          slug: `synthetic-task-${t + 1}`,
          depends: [],
          state: pick(states),
        });
      }
    }
    projects.push({
      id,
      name: NAMES[p]!,
      path: '',
      repo: `example/${NAMES[p]}`,
      branch: hasOrch ? 'orch/synthetic' : 'main',
      lastActivity: now0,
      orch: hasOrch
        ? {
            projectId: id,
            phase: 'running',
            statusText: '',
            handoffText: '',
            tasks,
            inflight: [],
            worktrees: ['t01', 't02', 't03'],
            blocked: [],
            updatedAt: now0,
          }
        : undefined,
    });
    prs.push({
      projectId: id,
      number: 10 + p,
      title: 'synthetic change',
      state: 'open',
      ci: pick(['pending', 'success', 'failure'] as const),
      url: '',
      headRef: 'synthetic',
      updatedAt: now0,
    });
    const nSessions = hasOrch ? 1 : 1 + Math.floor(rnd() * 2);
    for (let s = 0; s < nSessions; s++) {
      const sid = `synthetic-session-${p}-${s}`;
      const model = pick(MODELS);
      const sess: Session = {
        id: sid,
        projectId: id,
        title: 'Synthetic session',
        model,
        startedAt: now0 - Math.floor(rnd() * 3_600_000),
        lastActivity: now0,
        status: 'active',
        tokens: zeroTokens(),
        costUsd: 0,
        toolCalls: 0,
        agentIds: [sid],
      };
      sessions.push(sess);
      agents.push({
        id: sid,
        sessionId: sid,
        projectId: id,
        role: 'lead',
        model,
        label: 'lead',
        status: 'working',
        location: { kind: 'project', projectId: id },
        tokens: zeroTokens(),
        startedAt: sess.startedAt,
        lastActivity: now0,
      });
      const subs = hasOrch ? 3 + Math.floor(rnd() * 4) : Math.floor(rnd() * 2);
      for (let a = 0; a < subs; a++) {
        const role = pick(ROLES);
        const aid = `${sid}:sub${a}`;
        sess.agentIds.push(aid);
        const task = tasks.length ? pick(tasks) : undefined;
        agents.push({
          id: aid,
          sessionId: sid,
          projectId: id,
          role,
          model: pick(MODELS),
          label: `${role} ${task ? 't' + task.id : a}`,
          status: 'working',
          currentTask: task ? `t${task.id}` : undefined,
          location: task
            ? { kind: 'task', projectId: id, ref: `t${task.id}` }
            : { kind: 'project', projectId: id },
          tokens: zeroTokens(),
          startedAt: sess.startedAt,
          lastActivity: now0,
        });
      }
    }
  }

  const listeners = new Set<(e: FleetEvent) => void>();
  const changeListeners = new Set<() => void>();
  const events: FleetEvent[] = [];
  let snapshot: FleetSnapshot = build();
  let current: FleetView = makeView();
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticks = 0;

  function build(): FleetSnapshot {
    return {
      version: 1,
      generatedAt: Date.now(),
      demo: true,
      projects: projects.map((p) => ({
        ...p,
        orch: p.orch ? { ...p.orch, tasks: p.orch.tasks.map((t) => ({ ...t })) } : undefined,
      })),
      sessions: sessions.map((s) => ({ ...s, tokens: { ...s.tokens } })),
      agents: agents.map((a) => ({ ...a, location: { ...a.location }, tokens: { ...a.tokens } })),
      prs: prs.map((p) => ({ ...p })),
      releases: [],
      deploys: [],
      alerts: [],
    };
  }

  function makeView(): FleetView {
    const replay: ReplayControls = {
      from: now0,
      to: Date.now(),
      at: Date.now(),
      playing: false,
      speed: 1,
      seek: () => undefined,
      setPlaying: () => undefined,
      setSpeed: () => undefined,
      load: () => undefined,
      exit: () => undefined,
    };
    return {
      mode: 'demo',
      connected: true,
      snapshot,
      events: events.slice(),
      onEvent(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      replay,
      startReplay: () => undefined,
    };
  }

  function emit(
    kind: FleetEventKind,
    projectId: string,
    severity: Severity,
    label: string,
    extra: Partial<FleetEvent> = {},
  ) {
    const ts = Date.now();
    const e: FleetEvent = { id: `${ts}-${seq++}`, ts, kind, projectId, severity, label, ...extra };
    events.push(e);
    if (events.length > 300) events.shift();
    for (const l of listeners) l(e);
  }

  function step() {
    ticks++;
    const now = Date.now();
    const a = pick(agents);
    const proj = projects.find((p) => p.id === a.projectId)!;
    const sess = sessions.find((s) => s.id === a.sessionId)!;
    const tasks = proj.orch?.tasks ?? [];
    proj.lastActivity = now;
    a.lastActivity = now;
    const r = rnd();
    const tokIn = Math.floor(rnd() * 4000);
    a.tokens.input += tokIn;
    a.tokens.output += Math.floor(tokIn / 4);
    sess.tokens.input += tokIn;
    sess.tokens.output += Math.floor(tokIn / 4);
    sess.costUsd += tokIn * 0.000006;
    if (r < 0.4) {
      const tool = { name: pick(TOOLS), target: pick(TARGETS), at: now };
      a.lastTool = tool;
      sess.lastTool = tool;
      sess.toolCalls++;
      emit('agent.tool', proj.id, 'info', `${tool.name} ${tool.target}`, {
        agentId: a.id,
        sessionId: sess.id,
      });
    } else if (r < 0.62) {
      const kinds: AgentLocation['kind'][] = tasks.length
        ? ['task', 'task', 'review', 'ci', 'worktree', 'project']
        : ['project', 'ci', 'review'];
      const kind = pick(kinds);
      let to: AgentLocation = { kind, projectId: proj.id };
      if (kind === 'task' && tasks.length) {
        const t = pick(tasks);
        to = { kind, projectId: proj.id, ref: `t${t.id}` };
        a.currentTask = `t${t.id}`;
      } else if (kind === 'worktree')
        to = { kind, projectId: proj.id, ref: pick(proj.orch?.worktrees ?? ['t01']) };
      // occasionally hop to another project to show long arcs
      if (rnd() < 0.12) to = { kind: 'project', projectId: pick(projects).id };
      a.location = to;
      emit('agent.move', to.projectId, 'info', `${a.label} → ${to.kind}`, { agentId: a.id, to });
    } else if (r < 0.74 && tasks.length) {
      const t = pick(tasks);
      const order: OrchTaskState[] = ['queued', 'running', 'review', 'landed'];
      const idx = order.indexOf(t.state);
      t.state =
        idx >= 0 && idx < order.length - 1
          ? order[idx + 1]!
          : rnd() < 0.5
            ? 'queued'
            : t.state === 'blocked'
              ? 'running'
              : 'blocked';
      emit('task.state', proj.id, t.state === 'blocked' ? 'warn' : 'info', `t${t.id} ${t.state}`, {
        taskId: t.id,
        data: { state: t.state },
      });
      if (t.state === 'landed') emit('merge', proj.id, 'success', `t${t.id} merged`, { taskId: t.id });
      if (t.state === 'blocked') emit('blocked', proj.id, 'warn', `t${t.id} blocked`, { taskId: t.id });
    } else if (r < 0.82) {
      emit('test.run', proj.id, 'info', 'tests run', { agentId: a.id });
    } else if (r < 0.87) {
      const ok = rnd() < 0.7;
      const pr = prs.find((x) => x.projectId === proj.id)!;
      pr.ci = ok ? 'success' : 'failure';
      emit('ci', proj.id, ok ? 'success' : 'error', `CI ${ok ? 'passed' : 'failed'}`, {
        data: { state: pr.ci },
      });
    } else if (r < 0.91) {
      emit('deploy', proj.id, 'success', 'synthetic deploy ready');
    } else if (r < 0.93) {
      emit('release', proj.id, 'success', 'v0.0.1-synthetic');
    } else if (r < 0.96) {
      emit('failure', proj.id, 'error', 'synthetic failure', { agentId: a.id });
    } else {
      emit('review', proj.id, 'info', 'review requested', { agentId: a.id });
    }
    if (ticks % 4 === 0) {
      for (const p of projects) {
        if (!p.orch) continue;
        const ts = p.orch.tasks;
        p.orch.phase = ts.some((t) => t.state === 'blocked')
          ? 'blocked'
          : ts.every((t) => t.state === 'landed')
            ? 'done'
            : 'running';
        if (p.orch.phase === 'done') for (const t of ts) t.state = 'queued';
      }
      snapshot = build();
      current = makeView();
      for (const l of changeListeners) l();
    }
  }

  return {
    view: () => current,
    subscribe(cb) {
      changeListeners.add(cb);
      return () => changeListeners.delete(cb);
    },
    start() {
      if (timer) return;
      timer = setInterval(step, tickMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
