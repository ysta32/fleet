import { addTokens, estimateCostUsd, ZERO_TOKENS } from './pricing.js';
import type {
  Agent,
  AgentLocation,
  AgentRole,
  DemoFleet,
  FleetEvent,
  FleetSnapshot,
  HistoryResponse,
  ModelFamily,
  OrchTask,
  Project,
  Session,
} from './types.js';

const NAMES = ['aurora-api', 'nebula-ui', 'quasar-cli', 'helix-db', 'orbit-docs', 'pulsar-ml'];
const ROLES: [AgentRole, ModelFamily][] = [
  ['lead', 'fable'],
  ['coder', 'sonnet'],
  ['coder', 'astra'],
  ['critic', 'opus'],
  ['scout', 'haiku'],
  ['tester', 'sonnet'],
];
const STEP_MS = 800;

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

interface Army {
  project: Project;
  session: Session;
  agents: Agent[];
  taskIndex: number;
  stage: number;
  generation: number;
  waiting: boolean;
  ciFailed: boolean;
}

/** Purely synthetic metadata; dt and all timestamps are in milliseconds. */
export function createDemoFleet(opts: { seed?: number; now?: number; projects?: number } = {}): DemoFleet {
  const seed = opts.seed ?? 42;
  const projectCount = opts.projects ?? 6;
  let now = opts.now ?? Date.now();
  if (!Number.isFinite(seed) || !Number.isFinite(now)) {
    throw new RangeError('seed and now must be finite');
  }
  if (!Number.isInteger(projectCount) || projectCount < 1 || projectCount > 24) {
    throw new RangeError('projects must be an integer between 1 and 24');
  }
  const random = mulberry32(seed);
  let nextStep = now + STEP_MS;
  let sequence = 0;
  let turn = 0;
  const state: FleetSnapshot = {
    version: 1,
    demo: true,
    generatedAt: now,
    projects: Array.from({ length: projectCount }, (_, index) => {
      const name = NAMES[index % NAMES.length]! + (index >= NAMES.length ? `-${index + 1}` : '');
      return {
        id: `-synthetic-${name}`,
        name,
        path: `/synthetic/${name}`,
        branch: 'main',
        lastActivity: now,
      };
    }),
    sessions: [],
    agents: [],
    prs: [],
    releases: [],
    deploys: [],
    alerts: [],
  };

  function start(project: Project, generation: number): Army {
    state.sessions = state.sessions.filter((session) => session.projectId !== project.id);
    state.agents = state.agents.filter((agent) => agent.projectId !== project.id);
    const id = `${project.id}:run-${generation}`;
    const tasks: OrchTask[] = Array.from({ length: 8 + Math.floor(random() * 7) }, (_, index) => ({
      id: `t${String(index + 1).padStart(2, '0')}`,
      slug: ['schema', 'router', 'widget', 'adapter', 'checks', 'docs'][index % 6]!,
      depends: index < 2 ? [] : [`t${String(index - 1).padStart(2, '0')}`],
      route: index % 2 ? 'gpt_code' : 'claude_code',
      risk: 'normal',
      state: 'queued',
    }));
    project.orch = {
      projectId: project.id,
      branch: `orch/demo-${generation}`,
      phase: 'running',
      statusText: '',
      handoffText: '',
      tasks,
      inflight: [],
      worktrees: tasks.map((task) => task.id),
      blocked: [],
      updatedAt: now,
    };
    const agents: Agent[] = ROLES.map(([role, family], index) => ({
      id: index === 0 ? id : `${id}:a${index}`,
      sessionId: id,
      projectId: project.id,
      role,
      model: index === 0 && generation % 2 ? 'opus' : family,
      label: `${role} ${index || 'lead'}`,
      status: 'idle',
      location: { kind: 'project', projectId: project.id },
      tokens: { ...ZERO_TOKENS },
      startedAt: now,
      lastActivity: now,
    }));
    const session: Session = {
      id,
      projectId: project.id,
      title: `Synthetic ${project.name} build`,
      model: agents[0]!.model,
      startedAt: now,
      lastActivity: now,
      status: 'active',
      tokens: { ...ZERO_TOKENS },
      costUsd: 0,
      toolCalls: 0,
      agentIds: agents.map((agent) => agent.id),
    };
    state.sessions.push(session);
    state.agents.push(...agents);
    return { project, session, agents, generation, taskIndex: 0, stage: 0, waiting: false, ciFailed: false };
  }

  const armies = state.projects.slice(0, Math.min(3, projectCount)).map((project) => start(project, 0));

  function advance(army: Army, events: FleetEvent[]): void {
    const { project, session, agents } = army;
    const orch = project.orch!;
    const task = orch.tasks[army.taskIndex]!;
    const lead = agents[0]!;
    const coder = agents[1 + (army.taskIndex % 2)]!;
    const critic = agents[3]!;
    const scout = agents[4]!;
    const tester = agents[5]!;
    project.lastActivity = session.lastActivity = orch.updatedAt = now;

    function emit(
      kind: FleetEvent['kind'],
      label: string,
      agent = lead,
      severity: FleetEvent['severity'] = 'info',
      data?: FleetEvent['data'],
      to?: AgentLocation,
    ): void {
      agent.lastActivity = now;
      events.push({
        id: `${now}-${sequence++}`,
        ts: now,
        kind,
        projectId: project.id,
        sessionId: session.id,
        agentId: agent.id,
        taskId: task.id,
        severity,
        label,
        ...(data ? { data } : {}),
        ...(to ? { to: { ...to } } : {}),
      });
    }
    function move(agent: Agent, kind: AgentLocation['kind'], ref?: string): void {
      agent.location = { kind, projectId: project.id, ...(ref ? { ref } : {}) };
      agent.currentTask = kind === 'project' ? undefined : task.id;
      agent.status = 'working';
      emit('agent.move', `${agent.role} → ${kind}`, agent, 'info', undefined, agent.location);
    }
    function tool(agent: Agent, name: string, target: string): void {
      const usage = {
        input: 180 + Math.floor(random() * 650),
        output: 60 + Math.floor(random() * 240),
        cacheRead: 400 + Math.floor(random() * 1600),
        cacheWrite: 80,
      };
      agent.tokens = addTokens(agent.tokens, usage);
      session.tokens = addTokens(session.tokens, usage);
      session.costUsd += estimateCostUsd(
        agent.model === 'astra' ? 'gpt-demo' : `claude-${agent.model}`,
        usage,
      );
      agent.lastTool = { name, target, at: now };
      session.lastTool = { ...agent.lastTool };
      session.toolCalls++;
      emit('agent.tool', `${name} ${target}`, agent, 'info', { name, target });
    }
    function taskState(value: OrchTask['state']): void {
      task.state = value;
      emit('task.state', `${task.id} ${value}`, coder, value === 'landed' ? 'success' : 'info', {
        state: value,
      });
    }
    function alert(kind: 'session.waiting' | 'army.blocked' | 'ci.failed'): void {
      state.alerts.push({
        id: `alert-${now}-${sequence}`,
        kind,
        projectId: project.id,
        title: kind,
        body: `Synthetic ${task.id} checkpoint`,
        at: now,
      });
      state.alerts = state.alerts.slice(-12);
    }
    const prNumber = army.generation * 100 + army.taskIndex + 1;
    const pr = () => state.prs.find((entry) => entry.projectId === project.id && entry.number === prNumber)!;
    switch (army.stage++) {
      case 0:
        if (army.taskIndex === 0) emit('session.start', 'Synthetic army started');
        emit('agent.spawn', `${coder.role} assigned ${task.id}`, coder);
        taskState('running');
        orch.inflight = [
          {
            task: task.id,
            role: coder.role,
            agent: coder.id,
            worktree: task.id,
            baseSha: '0000000',
            started: new Date(now).toISOString().slice(11, 16),
          },
        ];
        move(coder, 'task', task.id);
        break;
      case 1:
        move(scout, 'task', task.id);
        tool(scout, 'Read', 'constellation.ts');
        break;
      case 2:
        move(coder, 'worktree', task.id);
        break;
      case 3:
        tool(coder, 'Read', 'orbit-router.ts');
        break;
      case 4:
        tool(coder, 'Edit', 'orbit-router.ts');
        break;
      case 5:
        army.waiting = random() < 0.18;
        if (army.waiting) {
          session.status = 'waiting';
          coder.status = 'waiting';
          taskState('blocked');
          orch.phase = 'blocked';
          orch.blocked = [task.id];
          emit('session.waiting', 'Waiting for synthetic dependency', coder, 'warn');
          emit('blocked', `${task.id} dependency paused`, coder, 'warn');
          alert('session.waiting');
          alert('army.blocked');
        } else tool(coder, 'Bash', 'npm');
        break;
      case 6:
        if (army.waiting) {
          session.status = 'active';
          coder.status = 'working';
          orch.phase = 'running';
          orch.blocked = [];
          taskState('running');
          for (const entry of state.alerts) if (entry.projectId === project.id) entry.cleared = true;
          emit('agent.status', 'Dependency ready', coder, 'info', { status: 'working' });
        }
        move(tester, 'worktree', task.id);
        tool(tester, 'Bash', 'vitest');
        break;
      case 7:
        emit('test.run', 'Synthetic checks passed', tester, 'success', { passed: 12, failed: 0 });
        break;
      case 8:
        taskState('review');
        move(coder, 'review', task.id);
        move(critic, 'review', task.id);
        break;
      case 9:
        tool(critic, 'Read', 'orbit-router.ts');
        emit('review', 'Review approved', critic, 'success', { verdict: 'approved' });
        break;
      case 10:
        state.prs.push({
          projectId: project.id,
          number: prNumber,
          title: `Synthetic ${task.slug}`,
          state: 'merged',
          ci: 'pending',
          url: `https://example.invalid/${project.name}/pull/${prNumber}`,
          headRef: `demo/${task.id}`,
          updatedAt: now,
        });
        state.prs = state.prs.slice(-24);
        taskState('landed');
        orch.inflight = [];
        emit('merge', `PR #${prNumber} merged`, coder, 'success', { number: prNumber });
        move(tester, 'ci', String(prNumber));
        break;
      case 11:
        army.ciFailed = random() < 0.22;
        pr().ci = army.ciFailed ? 'failure' : 'success';
        pr().updatedAt = now;
        emit('ci', army.ciFailed ? 'CI failed' : 'CI passed', tester, army.ciFailed ? 'error' : 'success', {
          state: pr().ci,
          number: prNumber,
        });
        if (army.ciFailed) {
          alert('ci.failed');
          move(coder, 'worktree', task.id);
        }
        break;
      case 12:
        if (army.ciFailed) {
          tool(coder, 'Edit', 'orbit-checks.ts');
          tool(tester, 'Bash', 'vitest');
        } else tool(lead, 'Read', 'release-notes.md');
        break;
      case 13:
        if (army.ciFailed) {
          emit('test.run', 'Repair checks passed', tester, 'success', { passed: 13, failed: 0 });
          pr().ci = 'success';
          pr().updatedAt = now;
          emit('ci', 'CI repaired', tester, 'success', { state: 'success', number: prNumber });
          for (const entry of state.alerts)
            if (entry.projectId === project.id && entry.kind === 'ci.failed') entry.cleared = true;
        } else emit('agent.status', 'Ready to ship', lead, 'info', { status: 'working' });
        break;
      case 14:
        if (army.taskIndex === orch.tasks.length - 1 || army.taskIndex % 4 === 3) {
          const id = `${session.id}:deploy-${army.taskIndex}`;
          state.deploys.push({
            id,
            projectId: project.id,
            environment: 'demo',
            state: 'ready',
            createdAt: now,
          });
          state.deploys = state.deploys.slice(-12);
          move(lead, 'deploy', id);
          emit('deploy', 'Synthetic deployment ready', lead, 'success', { state: 'ready', id });
          const tag = `v0.${army.generation}.${army.taskIndex + 1}`;
          state.releases.push({
            projectId: project.id,
            tag,
            name: `Demo ${tag}`,
            url: `https://example.invalid/${project.name}/releases/${tag}`,
            publishedAt: now,
          });
          state.releases = state.releases.slice(-12);
          emit('release', `${tag} released`, lead, 'success', { tag });
        }
        break;
      case 15:
        for (const agent of agents) {
          move(agent, 'project');
          agent.status = 'idle';
        }
        if (++army.taskIndex < orch.tasks.length) army.stage = 0;
        else {
          orch.phase = 'done';
          session.status = 'ended';
          for (const agent of agents) agent.status = 'done';
          emit('army.done', 'All synthetic tasks landed', lead, 'success');
          emit('session.end', 'Synthetic session ended', lead, 'success');
          // Keep the completed army visible until its next scheduled turn.
          army.taskIndex--;
        }
        break;
      default: {
        const index = state.projects.indexOf(project);
        const next = state.projects[(index + armies.length) % projectCount]!;
        // Uneven project counts can point at another live army; keep this lane in that case.
        const destination = armies.some((other) => other !== army && other.project === next) ? project : next;
        Object.assign(army, start(destination, army.generation + 1));
        advance(army, events);
      }
    }
  }

  function snapshot(): FleetSnapshot {
    // Explicit copies keep history frames isolated without serializing the entire fleet.
    return {
      ...state,
      generatedAt: now,
      projects: state.projects.map((project) => ({
        ...project,
        ...(project.orch
          ? {
              orch: {
                ...project.orch,
                tasks: project.orch.tasks.map((task) => ({ ...task, depends: [...task.depends] })),
                inflight: project.orch.inflight.map((entry) => ({ ...entry })),
                worktrees: [...project.orch.worktrees],
                blocked: [...project.orch.blocked],
              },
            }
          : {}),
      })),
      sessions: state.sessions.map((session) => ({
        ...session,
        tokens: { ...session.tokens },
        agentIds: [...session.agentIds],
        ...(session.lastTool ? { lastTool: { ...session.lastTool } } : {}),
      })),
      agents: state.agents.map((agent) => ({
        ...agent,
        tokens: { ...agent.tokens },
        location: { ...agent.location },
        ...(agent.lastTool ? { lastTool: { ...agent.lastTool } } : {}),
      })),
      prs: state.prs.map((entry) => ({ ...entry })),
      releases: state.releases.map((entry) => ({ ...entry })),
      deploys: state.deploys.map((entry) => ({ ...entry })),
      alerts: state.alerts.map((entry) => ({ ...entry })),
    };
  }

  function tick(dtMs: number): FleetEvent[] {
    if (!Number.isFinite(dtMs) || dtMs < 0 || !Number.isFinite(now + dtMs)) {
      throw new RangeError('dtMs must be finite and nonnegative');
    }
    const end = now + dtMs;
    const events: FleetEvent[] = [];
    while (nextStep <= end) {
      now = nextStep;
      advance(armies[turn++ % armies.length]!, events);
      nextStep += STEP_MS;
    }
    now = end;
    return events;
  }

  function history(hours: number): HistoryResponse {
    if (!Number.isFinite(hours) || hours < 0) throw new RangeError('hours must be finite and nonnegative');
    const from = now - Math.min(hours, 24) * 3_600_000;
    const replay = createDemoFleet({ seed, now: from, projects: projectCount });
    const frames = [replay.snapshot()];
    const events: FleetEvent[] = [];
    for (let elapsed = 0; elapsed < now - from;) {
      const dt = Math.min(30_000, now - from - elapsed);
      events.push(...replay.tick(dt));
      elapsed += dt;
      if (elapsed % 30_000 === 0) frames.push(replay.snapshot());
    }
    return { from, to: now, frames, events };
  }

  return { snapshot, tick, history };
}
