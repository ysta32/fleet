import {
  ZERO_TOKENS,
  addTokens,
  estimateCostUsd,
  eventId,
  modelFamily,
  projectNameFromPath,
  roleFromSubagentType,
  sanitizeTarget,
  truncate,
  type Agent,
  type AgentLocation,
  type AgentRole,
  type AgentStatus,
  type FleetEvent,
  type FleetEventKind,
  type ModelFamily,
  type Session,
  type SessionStatus,
  type Severity,
  type TokenUsage,
  type ToolCallSummary,
} from '@fleet/shared';
import type { TranscriptFile } from './tailer.js';

/** Session counts as active while its last activity is within this window. */
export const ACTIVE_MS = 2 * 60_000;
/** After an end_turn with no pending tool, the session is "waiting" once idle this long. */
export const WAITING_AFTER_MS = 30_000;
/** Past this idle time a session is ended. */
export const ENDED_MS = 30 * 60_000;

const TEST_RUNNERS = new Set([
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'pytest',
  'vitest',
  'jest',
  'go',
  'cargo',
  'xcodebuild',
  'swift',
  'make',
]);
const MODEL_ALIASES = new Set<ModelFamily>(['opus', 'sonnet', 'haiku', 'fable']);
const WORKTREE_RE = /\/\.orch\/wt\/([^/\\]+)/;
const SAFE_ID_RE = /^[A-Za-z0-9._-]{1,60}$/;
const SAFE_TAG_RE = /^v?[0-9A-Za-z._-]{1,32}$/;

type Json = Record<string, unknown>;

interface MessageUsage {
  modelId?: string;
  tokens: TokenUsage;
}

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

function parseTs(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

function safeId(v: unknown): string | undefined {
  return typeof v === 'string' && SAFE_ID_RE.test(v) ? v : undefined;
}

function safeToolName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const name = truncate(v.replace(/[^A-Za-z0-9_.:-]/g, ''), 60);
  return name || undefined;
}

function maxTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: Math.max(a.input, b.input),
    output: Math.max(a.output, b.output),
    cacheRead: Math.max(a.cacheRead, b.cacheRead),
    cacheWrite: Math.max(a.cacheWrite, b.cacheWrite),
  };
}

function subTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input - b.input,
    output: a.output - b.output,
    cacheRead: a.cacheRead - b.cacheRead,
    cacheWrite: a.cacheWrite - b.cacheWrite,
  };
}

function sameLocation(a: AgentLocation, b: AgentLocation): boolean {
  return a.kind === b.kind && a.projectId === b.projectId && a.ref === b.ref;
}

/** Family for an Agent-tool `model` input, which may be an alias ("opus") or a full id. */
function familyOfModelInput(v: string): ModelFamily {
  const lower = v.toLowerCase();
  return MODEL_ALIASES.has(lower as ModelFamily) ? (lower as ModelFamily) : modelFamily(lower);
}

/**
 * Pure incremental parser: Claude Code transcript JSONL lines -> Session/Agent state + FleetEvents.
 *
 * Privacy: only metadata is retained (ids, timestamps, models, token counts, tool names and
 * `sanitizeTarget` labels). Message text, thinking, tool inputs/results are never stored or emitted.
 *
 * session.waiting is emitted from `ingest` once `session(now).status` becomes "waiting"
 * (end_turn, no pending tool, idle > 30s), at most once per turn. Callers should therefore
 * also call `ingest([], now)` periodically as a clock tick.
 *
 * Subagent files: one Agent with id `${parentSessionId}:${agentFileId}`, no session.start /
 * session.waiting events; `session(now)` returns a summary (id === that agent id, agentIds ===
 * [agent id]) that the daemon folds into the parent session instead of storing it.
 */
export class SessionParser {
  readonly isSubagent: boolean;
  private readonly file: TranscriptFile;
  private readonly sessionId: string;
  private readonly agentId: string;

  private started = false;
  private startedAt: number | undefined;
  private lastActivity: number | undefined;
  private title: string | undefined;
  private gitBranch: string | undefined;
  private modelId: string | undefined;
  private subagentType: string | undefined;

  private readonly usageByMessage = new Map<string, MessageUsage>();
  private tokens: TokenUsage = { ...ZERO_TOKENS };
  private costUsd = 0;

  private lastTool: ToolCallSummary | undefined;
  private toolCalls = 0;
  private readonly pendingTools = new Set<string>();

  private turnEnded = false;
  private endTurnMessageId: string | undefined;
  private turnSeq = 0;
  private waitingEmittedTurn = -1;

  private baseLocation: AgentLocation;
  private location: AgentLocation;
  private worktreeId: string | undefined;

  constructor(file: TranscriptFile) {
    this.file = file;
    this.isSubagent = file.isSubagent;
    if (file.isSubagent) {
      this.sessionId = file.parentSessionId ?? file.sessionId;
      const fileId =
        file.agentFileId ??
        projectNameFromPath(file.path)
          .replace(/\.jsonl$/, '')
          .replace(/^agent-/, '');
      this.agentId = `${this.sessionId}:${fileId}`;
    } else {
      this.sessionId = file.sessionId;
      this.agentId = file.sessionId;
    }
    this.baseLocation = { kind: 'project', projectId: file.projectId };
    this.location = this.baseLocation;
  }

  ingest(lines: string[], now: number): FleetEvent[] {
    const events: FleetEvent[] = [];
    for (const raw of lines) {
      if (!raw || !raw.trim()) continue;
      let line: unknown;
      try {
        line = JSON.parse(raw);
      } catch {
        // Partial/corrupt line (e.g. the tailer started mid-file): not transcript data, skip it.
        continue;
      }
      if (isObj(line)) this.ingestLine(line, now, events);
    }
    if (!this.isSubagent && this.turnEnded && this.waitingEmittedTurn !== this.turnSeq) {
      if (this.status(now) === 'waiting') {
        this.waitingEmittedTurn = this.turnSeq;
        events.push(this.event('session.waiting', now, 'warn', 'Waiting for input'));
      }
    }
    return events;
  }

  session(now: number): Session {
    const session: Session = {
      id: this.isSubagent ? this.agentId : this.sessionId,
      projectId: this.file.projectId,
      model: modelFamily(this.modelId),
      startedAt: this.startedAt ?? now,
      lastActivity: this.lastActivity ?? this.startedAt ?? now,
      status: this.status(now),
      tokens: { ...this.tokens },
      costUsd: this.costUsd,
      toolCalls: this.toolCalls,
      agentIds: [this.agentId],
    };
    if (this.title !== undefined) session.title = this.title;
    if (this.modelId !== undefined) session.modelId = this.modelId;
    if (this.lastTool) session.lastTool = { ...this.lastTool };
    if (this.gitBranch !== undefined) session.gitBranch = this.gitBranch;
    return session;
  }

  agents(now: number): Agent[] {
    const role = this.role();
    const agent: Agent = {
      id: this.agentId,
      sessionId: this.sessionId,
      projectId: this.file.projectId,
      role,
      model: modelFamily(this.modelId),
      label: truncate(this.worktreeId ? `${role} ${this.worktreeId}` : role, 80),
      status: this.agentStatus(now),
      location: { ...this.location },
      tokens: { ...this.tokens },
      startedAt: this.startedAt ?? now,
      lastActivity: this.lastActivity ?? this.startedAt ?? now,
    };
    if (this.worktreeId) agent.currentTask = this.worktreeId;
    if (this.lastTool) agent.lastTool = { ...this.lastTool };
    return [agent];
  }

  private role(): AgentRole {
    return this.isSubagent ? roleFromSubagentType(this.subagentType) : 'lead';
  }

  private idleMs(now: number): number {
    return now - (this.lastActivity ?? this.startedAt ?? now);
  }

  private status(now: number): SessionStatus {
    const idle = this.idleMs(now);
    if (idle >= ENDED_MS) return 'ended';
    if (this.turnEnded && this.pendingTools.size === 0 && idle > WAITING_AFTER_MS) return 'waiting';
    return idle < ACTIVE_MS ? 'active' : 'idle';
  }

  private agentStatus(now: number): AgentStatus {
    if (this.isSubagent) {
      // A subagent's final end_turn means it returned its result to the parent.
      if (this.turnEnded && this.pendingTools.size === 0) return 'done';
      const idle = this.idleMs(now);
      if (idle >= ENDED_MS) return 'done';
      return idle < ACTIVE_MS ? 'working' : 'idle';
    }
    switch (this.status(now)) {
      case 'active':
        return 'working';
      case 'waiting':
        return 'waiting';
      case 'idle':
        return 'idle';
      case 'ended':
        return 'done';
    }
  }

  private event(
    kind: FleetEventKind,
    ts: number,
    severity: Severity,
    label: string,
    extra?: Pick<FleetEvent, 'to' | 'data'>,
  ): FleetEvent {
    const e: FleetEvent = {
      id: eventId(ts),
      ts,
      kind,
      projectId: this.file.projectId,
      sessionId: this.sessionId,
      agentId: this.agentId,
      severity,
      label: truncate(label, 80),
    };
    if (extra?.to) e.to = extra.to;
    if (extra?.data) e.data = extra.data;
    return e;
  }

  private ingestLine(line: Json, now: number, events: FleetEvent[]): void {
    const lineTs = parseTs(line.timestamp);
    const ts = lineTs ?? this.lastActivity ?? now;

    // session.start fires on the first timestamped line (leading metadata lines such as
    // permission-mode / file-history-snapshot carry no timestamp of their own).
    if (!this.started && lineTs !== undefined) {
      this.started = true;
      if (!this.isSubagent) events.push(this.event('session.start', lineTs, 'info', 'Session started'));
    }
    if (lineTs !== undefined) {
      if (this.startedAt === undefined || lineTs < this.startedAt) this.startedAt = lineTs;
      if (this.lastActivity === undefined || lineTs > this.lastActivity) this.lastActivity = lineTs;
    }

    if (line.type === 'ai-title') {
      if (typeof line.aiTitle === 'string' && line.aiTitle.trim()) {
        this.title = truncate(line.aiTitle.trim(), 80);
      }
      return;
    }
    if (line.type !== 'user' && line.type !== 'assistant') return;

    // A sidechain line inside a main transcript belongs to a (legacy inline) subagent: count its
    // cost, but it must not drive the lead's turn state, model, location or tool events.
    const foreign = !this.isSubagent && line.isSidechain === true;

    if (typeof line.gitBranch === 'string' && line.gitBranch && line.gitBranch !== 'HEAD') {
      this.gitBranch = truncate(line.gitBranch, 120);
    }
    if (this.isSubagent && this.subagentType === undefined) {
      const t = line.subagentType ?? line.agentType;
      if (typeof t === 'string') this.subagentType = t;
    }
    if (!foreign && typeof line.cwd === 'string') this.updateCwd(line.cwd, ts, events);

    const message = isObj(line.message) ? line.message : undefined;
    if (!message) return;
    const content = Array.isArray(message.content) ? message.content : [];

    if (line.type === 'user') {
      for (const item of content) {
        if (isObj(item) && item.type === 'tool_result' && typeof item.tool_use_id === 'string') {
          this.pendingTools.delete(item.tool_use_id);
        }
      }
      if (!foreign) this.turnEnded = false;
      return;
    }

    // assistant
    const msgId = typeof message.id === 'string' ? message.id : undefined;
    const model = typeof message.model === 'string' ? message.model : undefined;
    const realModel = model && model !== '<synthetic>' ? model : undefined;
    if (realModel && !foreign) this.modelId = realModel;
    this.addUsage(
      msgId ?? (typeof line.uuid === 'string' ? `uuid:${line.uuid}` : undefined),
      realModel,
      message.usage,
    );

    if (foreign) return;

    let hasToolUse = false;
    for (const item of content) {
      if (!isObj(item) || item.type !== 'tool_use') continue;
      hasToolUse = true;
      if (typeof item.id === 'string') this.pendingTools.add(item.id);
      this.onToolUse(item, ts, events);
    }

    if (message.stop_reason === 'end_turn' && !hasToolUse) {
      if (!this.turnEnded || this.endTurnMessageId !== msgId) {
        this.turnEnded = true;
        this.endTurnMessageId = msgId;
        this.turnSeq++;
      }
    } else if (hasToolUse || (msgId !== undefined && msgId !== this.endTurnMessageId)) {
      this.turnEnded = false;
    }
  }

  /** Count usage once per message id; repeated lines of one message may only grow it. */
  private addUsage(key: string | undefined, modelId: string | undefined, usage: unknown): void {
    if (!isObj(usage)) return;
    const next: TokenUsage = {
      input: num(usage.input_tokens),
      output: num(usage.output_tokens),
      cacheRead: num(usage.cache_read_input_tokens),
      cacheWrite: num(usage.cache_creation_input_tokens),
    };
    const prev = key !== undefined ? this.usageByMessage.get(key) : undefined;
    const prevTokens = prev?.tokens ?? ZERO_TOKENS;
    const merged = maxTokens(prevTokens, next);
    const model = modelId ?? prev?.modelId;
    this.tokens = addTokens(this.tokens, subTokens(merged, prevTokens));
    this.costUsd += estimateCostUsd(model, merged) - (prev ? estimateCostUsd(prev.modelId, prevTokens) : 0);
    if (key !== undefined) this.usageByMessage.set(key, { modelId: model, tokens: merged });
  }

  private updateCwd(cwd: string, ts: number, events: FleetEvent[]): void {
    const m = WORKTREE_RE.exec(cwd);
    const wt = m ? safeId(m[1]) : undefined;
    if (wt === this.worktreeId) return;
    this.worktreeId = wt;
    this.baseLocation = wt
      ? { kind: 'worktree', projectId: this.file.projectId, ref: wt }
      : { kind: 'project', projectId: this.file.projectId };
    this.moveTo(this.baseLocation, ts, events);
  }

  private moveTo(to: AgentLocation, ts: number, events: FleetEvent[]): void {
    if (sameLocation(this.location, to)) return;
    this.location = to;
    const label = to.ref ? `→ ${to.kind} ${to.ref}` : `→ ${to.kind}`;
    events.push(this.event('agent.move', ts, 'info', label, { to: { ...to } }));
  }

  private onToolUse(item: Json, ts: number, events: FleetEvent[]): void {
    const name = safeToolName(item.name);
    if (!name) return;
    const input = item.input;
    const target = sanitizeTarget(name, input);
    const summary: ToolCallSummary = { name, at: ts };
    if (target) summary.target = target;
    this.lastTool = summary;
    this.toolCalls++;
    events.push(
      this.event('agent.tool', ts, 'info', target ? `${name} ${target}` : name, {
        data: target ? { tool: name, target } : { tool: name },
      }),
    );

    let review = false;
    const fields = isObj(input) ? input : {};

    if (name === 'Agent' || name === 'Task') {
      const subType = typeof fields.subagent_type === 'string' ? fields.subagent_type : undefined;
      const role = roleFromSubagentType(subType);
      const data: Record<string, string> = { role };
      if (target) data.subagentType = target;
      if (typeof fields.model === 'string' && fields.model) {
        data.model = familyOfModelInput(fields.model);
      }
      events.push(this.event('agent.spawn', ts, 'info', `Spawn ${role}`, { data }));
      review = role === 'critic' || (subType !== undefined && /critic|review/i.test(subType));
    } else if (name === 'Bash' && typeof fields.command === 'string') {
      review = this.onBash(fields.command, ts, events);
    }

    this.moveTo(review ? { kind: 'review', projectId: this.file.projectId } : this.baseLocation, ts, events);
  }

  /**
   * Detect test/merge/release/review from the *executed* simple commands only (quoted text,
   * comments and heredoc bodies never match). Returns true when this is a review run.
   */
  private onBash(cmd: string, ts: number, events: FleetEvent[]): boolean {
    let test: string | undefined;
    let merge: { pr?: number } | undefined;
    let release: { tag?: string } | undefined;
    let review = false;
    for (const segment of commandSegments(cmd)) {
      const words = leadingCommand(segment);
      const head = words[0];
      if (head === undefined) continue;
      const runner = projectNameFromPath(head);
      if (!test && TEST_RUNNERS.has(runner) && words.slice(1).some((w) => /test/i.test(w))) test = runner;
      if (head === 'gh' && words[1] === 'pr' && words[2] === 'merge') {
        const m = /^#?(\d{1,7})$/.exec(firstArg(words, 3) ?? '');
        merge ??= m ? { pr: Number(m[1]) } : {};
      } else if (head === 'git') {
        const sub = words[1] === '-C' ? words[3] : words[1];
        if (sub === 'merge') merge ??= {};
      }
      if (head === 'gh' && words[1] === 'release' && words[2] === 'create') {
        const tag = firstArg(words, 3);
        release ??= tag !== undefined && SAFE_TAG_RE.test(tag) ? { tag } : {};
      }
      if (head === 'gpt' && words[1] === 'code' && words.slice(2).includes('ro')) review = true;
    }
    if (test) events.push(this.event('test.run', ts, 'info', `Tests (${test})`, { data: { runner: test } }));
    if (merge) {
      const pr = merge.pr;
      events.push(
        this.event('merge', ts, 'success', pr !== undefined ? `PR #${pr} merged` : 'Branch merged', {
          data: pr !== undefined ? { pr } : undefined,
        }),
      );
    }
    if (release) {
      const tag = release.tag;
      events.push(
        this.event('release', ts, 'success', tag ? `Release ${tag}` : 'Release created', {
          data: tag ? { tag } : undefined,
        }),
      );
    }
    return review;
  }
}

/** Strip leading `VAR=value` assignments from a simple command. */
function leadingCommand(words: string[]): string[] {
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i] ?? '')) i++;
  return words.slice(i);
}

/** First non-flag word at or after index `from`. */
function firstArg(words: string[], from: number): string | undefined {
  for (let i = from; i < words.length; i++) {
    const w = words[i];
    if (w !== undefined && !w.startsWith('-')) return w;
  }
  return undefined;
}

/**
 * Best-effort split of a shell command into executed simple commands (word lists).
 * Quoted text stays inside a single word; `;`, `&`, `|`, `(`, `)`, backticks and newlines
 * separate commands; `#` comments and heredoc bodies are dropped.
 */
export function commandSegments(cmd: string): string[][] {
  const segments: string[][] = [];
  const heredocs: { delim: string; strip: boolean }[] = [];
  let words: string[] = [];
  let word = '';
  let inWord = false;
  const endWord = (): void => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endSegment = (): void => {
    endWord();
    if (words.length) segments.push(words);
    words = [];
  };
  const n = cmd.length;
  let i = 0;
  while (i < n) {
    const c = cmd[i] as string;
    if (c === '\n') {
      endSegment();
      i++;
      for (const h of heredocs) {
        while (i < n) {
          const nl = cmd.indexOf('\n', i);
          const end = nl < 0 ? n : nl;
          const body = cmd.slice(i, end);
          i = end + 1;
          if ((h.strip ? body.replace(/^\t+/, '') : body) === h.delim) break;
        }
      }
      heredocs.length = 0;
      continue;
    }
    if (c === "'") {
      const close = cmd.indexOf("'", i + 1);
      const end = close < 0 ? n : close;
      word += cmd.slice(i + 1, end);
      inWord = true;
      i = end + 1;
      continue;
    }
    if (c === '"') {
      inWord = true;
      i++;
      while (i < n && cmd[i] !== '"') {
        if (cmd[i] === '\\' && i + 1 < n) {
          word += cmd[i + 1];
          i += 2;
        } else {
          word += cmd[i];
          i++;
        }
      }
      i++;
      continue;
    }
    if (c === '\\') {
      if (i + 1 < n && cmd[i + 1] !== '\n') {
        word += cmd[i + 1];
        inWord = true;
      }
      i += 2;
      continue;
    }
    if (c === '#' && !inWord) {
      const nl = cmd.indexOf('\n', i);
      i = nl < 0 ? n : nl;
      continue;
    }
    if (c === '<' && cmd[i + 1] === '<' && cmd[i + 2] !== '<') {
      endWord();
      i += 2;
      let strip = false;
      if (cmd[i] === '-') {
        strip = true;
        i++;
      }
      while (cmd[i] === ' ' || cmd[i] === '\t') i++;
      let delim = '';
      while (i < n && !/[\s;&|<>()]/.test(cmd[i] as string)) {
        const ch = cmd[i] as string;
        if (ch !== '"' && ch !== "'" && ch !== '\\') delim += ch;
        i++;
      }
      if (delim) heredocs.push({ delim, strip });
      continue;
    }
    if (c === ';' || c === '&' || c === '|' || c === '(' || c === ')' || c === '`') {
      endSegment();
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      endWord();
      i++;
      continue;
    }
    word += c;
    inWord = true;
    i++;
  }
  endSegment();
  return segments;
}
