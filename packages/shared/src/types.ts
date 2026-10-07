/**
 * FROZEN CONTRACT (v1). Every package builds against these shapes.
 * Changes require a DECISION in .orch/DECISIONS.md and a coordinated update.
 *
 * PRIVACY: nothing in these types may carry raw transcript message content
 * (prompts, assistant text, tool inputs/outputs). Only metadata: names, counts,
 * timestamps, models, sanitized short labels (see `ToolCallSummary.target`).
 */

export const PROTOCOL_VERSION = 1 as const;
export const DEFAULT_PORT = 4747;

/** Model family, color-coded in the UI. */
export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'fable' | 'astra' | 'unknown';

/** Role of an agent inside a session / orch army. */
export type AgentRole = 'lead' | 'senior' | 'coder' | 'critic' | 'scout' | 'tester' | 'triager' | 'other';

export type AgentStatus = 'working' | 'idle' | 'waiting' | 'done' | 'failed';
export type SessionStatus = 'active' | 'idle' | 'waiting' | 'ended';

/** Where an agent "is" in the visualizer. */
export type LocationKind = 'project' | 'task' | 'worktree' | 'review' | 'ci' | 'deploy';
export interface AgentLocation {
  kind: LocationKind;
  projectId: string;
  /** task id, worktree id, PR number, ... */
  ref?: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ToolCallSummary {
  /** Tool name, e.g. "Edit", "Bash", "Agent". */
  name: string;
  /**
   * Sanitized short label, max 60 chars: a file basename for file tools,
   * the first token of a command for Bash (e.g. "npm", "git"), subagent type for Agent.
   * Never the full command, file contents, prompts or URLs with query strings.
   */
  target?: string;
  /** epoch ms */
  at: number;
}

export interface Project {
  /** stable id: slug of absolute path, e.g. "-Users-me-dev-fleet" (same encoding as ~/.claude/projects dirs) */
  id: string;
  /** display name: basename of path */
  name: string;
  /** absolute path on disk (local only; redacted to "" for remote clients) */
  path: string;
  /** "owner/name" when a GitHub remote exists */
  repo?: string;
  branch?: string;
  lastActivity: number;
  /** present when the repo has a .orch/ directory */
  orch?: OrchRun;
}

export interface Session {
  id: string;
  projectId: string;
  /** ai-title from the transcript if present (a short summary title, not message content) */
  title?: string;
  model: ModelFamily;
  /** raw model id e.g. "claude-opus-4-1" */
  modelId?: string;
  startedAt: number;
  lastActivity: number;
  status: SessionStatus;
  tokens: TokenUsage;
  /** estimated USD cost, see shared/pricing.ts */
  costUsd: number;
  lastTool?: ToolCallSummary;
  toolCalls: number;
  /** ids of agents belonging to this session (the lead + subagents) */
  agentIds: string[];
  gitBranch?: string;
}

export interface Agent {
  /** lead agent id == session id; subagents: "<sessionId>:<agentId>" ; astra jobs: "<projectId>:astra:<task>" */
  id: string;
  sessionId: string;
  projectId: string;
  role: AgentRole;
  model: ModelFamily;
  /** short label e.g. "coder t04" */
  label: string;
  status: AgentStatus;
  currentTask?: string;
  location: AgentLocation;
  lastTool?: ToolCallSummary;
  tokens: TokenUsage;
  startedAt: number;
  lastActivity: number;
}

export type OrchTaskState = 'queued' | 'running' | 'review' | 'landed' | 'blocked' | 'failed';
export interface OrchTask {
  /** e.g. "04" or "t04" as written in TASKS/ file name prefix */
  id: string;
  slug: string;
  depends: string[];
  route?: string;
  risk?: 'low' | 'normal' | 'high';
  state: OrchTaskState;
}
export interface InflightEntry {
  task: string;
  role: string;
  agent: string;
  worktree: string;
  baseSha: string;
  /** "HH:MM" as written */
  started: string;
}
export type OrchPhase = 'running' | 'blocked' | 'done' | 'idle';
export interface OrchRun {
  projectId: string;
  /** branch name e.g. "orch/20261007-0900" if detectable */
  branch?: string;
  phase: OrchPhase;
  /** first ~12 lines of STATUS.md (local only; redacted for remote clients unless shareContent) */
  statusText: string;
  /** first ~10 lines of HANDOFF.md (same redaction rule) */
  handoffText: string;
  tasks: OrchTask[];
  inflight: InflightEntry[];
  /** worktree ids under .orch/wt */
  worktrees: string[];
  blocked: string[];
  updatedAt: number;
}

export type CiState = 'pending' | 'success' | 'failure' | 'none';
export interface PullRequest {
  projectId: string;
  number: number;
  title: string;
  state: 'open' | 'merged' | 'closed';
  ci: CiState;
  url: string;
  headRef: string;
  updatedAt: number;
}
export interface Release {
  projectId: string;
  tag: string;
  name: string;
  url: string;
  publishedAt: number;
}
export interface Deploy {
  projectId: string;
  id: string;
  environment: string;
  state: 'building' | 'ready' | 'error' | 'canceled';
  url?: string;
  createdAt: number;
}

export type AlertKind =
  'army.done' | 'army.blocked' | 'ci.failed' | 'session.waiting' | 'deploy.failed' | 'spend.budget';
export interface Alert {
  id: string;
  kind: AlertKind;
  projectId: string;
  title: string;
  body: string;
  at: number;
  /** cleared alerts stay for history but are hidden in the UI */
  cleared?: boolean;
}

export interface FleetSnapshot {
  version: typeof PROTOCOL_VERSION;
  generatedAt: number;
  /** true when produced by the synthetic demo generator */
  demo?: boolean;
  projects: Project[];
  sessions: Session[];
  agents: Agent[];
  prs: PullRequest[];
  releases: Release[];
  deploys: Deploy[];
  alerts: Alert[];
  /** Fleet Spend brief (absent when fleet-spend is not installed) */
  spend?: import('./spend.js').SpendBrief;
}

export type FleetEventKind =
  | 'session.start'
  | 'session.end'
  | 'session.waiting'
  | 'agent.spawn'
  | 'agent.move'
  | 'agent.tool'
  | 'agent.status'
  | 'task.state'
  | 'test.run'
  | 'review'
  | 'merge'
  | 'deploy'
  | 'release'
  | 'ci'
  | 'blocked'
  | 'army.done'
  | 'failure';

export type Severity = 'info' | 'success' | 'warn' | 'error';

/** One animatable thing that happened. Drives visual effects + notifications. */
export interface FleetEvent {
  /** unique, monotonic-ish: `${ts}-${seq}` */
  id: string;
  ts: number;
  kind: FleetEventKind;
  projectId: string;
  sessionId?: string;
  agentId?: string;
  taskId?: string;
  severity: Severity;
  /** short human label, e.g. "Edit store.ts", "PR #12 merged" (sanitized, ≤80 chars) */
  label: string;
  /** destination for agent.move */
  to?: AgentLocation;
  data?: Record<string, string | number | boolean | null>;
}

/* ---------------- HTTP / stream API (collector) ----------------
 * GET  /api/health                      -> { ok: true, version: string, protocol: 1 }
 * GET  /api/snapshot                    -> FleetSnapshot
 * GET  /api/events                      -> text/event-stream:
 *        event: snapshot   data: FleetSnapshot        (on connect, then at most every 2s when state changed)
 *        event: fleet      data: FleetEvent           (each event, as it happens)
 *        : ping                                       (comment heartbeat every 15s)
 * GET  /api/history?from=<ms>&to=<ms>   -> HistoryResponse   (replay; default last 6h, max 24h)
 * GET  /                                -> web UI static files (packages/web/dist)
 * Auth: requests from loopback are allowed without token. Non-loopback (only when lan=true)
 *       require `Authorization: Bearer <token>` or `?token=<token>` (EventSource). 401 otherwise.
 * Remote (non-loopback) clients receive redacted snapshots: Project.path = "", statusText/handoffText = ""
 *       unless config.shareContent === true.
 */
export interface HistoryResponse {
  from: number;
  to: number;
  /** keyframes, at most one per 30s */
  frames: FleetSnapshot[];
  events: FleetEvent[];
}

export type StreamMessage =
  { type: 'snapshot'; snapshot: FleetSnapshot } | { type: 'event'; event: FleetEvent };

/* ---------------- Config (~/.config/fleet/config.json) ---------------- */
export interface FleetConfig {
  port: number; // default DEFAULT_PORT (4747)
  /** bind host; "127.0.0.1" unless lan=true, then "0.0.0.0" */
  lan: boolean;
  /** random 32-byte hex, generated on first run */
  token: string;
  /** root of claude transcripts, default ~/.claude/projects */
  claudeProjectsDir: string;
  /** sessions with activity within this window are considered (default 24h) */
  recentWindowMs: number;
  /** allow redactable text (STATUS/HANDOFF excerpts) to remote clients */
  shareContent: boolean;
  notify: {
    macos: boolean;
    /** ntfy topic URL e.g. "https://ntfy.sh/fleet-abc123"; empty = disabled */
    ntfyUrl: string;
    kinds: AlertKind[];
  };
  /** poll GitHub via `gh` (read-only) */
  github: boolean;
  githubPollMs: number;
}

/* ---------------- Synthetic demo generator (packages/shared/src/demo.ts) ----------------
 * Fully synthetic, deterministic for a given seed. Never reads real data.
 * export function createDemoFleet(opts?: { seed?: number; now?: number; projects?: number }): DemoFleet
 */
export interface DemoFleet {
  /** current synthetic state at the internal clock */
  snapshot(): FleetSnapshot;
  /** advance the internal clock by dtMs; returns events that occurred, in order */
  tick(dtMs: number): FleetEvent[];
  /** synthetic history covering the last `hours` before the current clock */
  history(hours: number): HistoryResponse;
}
