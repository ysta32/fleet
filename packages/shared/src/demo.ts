import { addTokens, estimateCostUsd, ZERO_TOKENS } from './pricing.js';
import { formatLocalTime } from './time.js';
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

/** Synthetic project names shared by every demo surface (harbour, Spend, Overnight). */
export const DEMO_PROJECT_NAMES = [
  'aurora-api',
  'nebula-ui',
  'quasar-cli',
  'helix-db',
  'orbit-docs',
  'pulsar-ml',
];
const NAMES = DEMO_PROJECT_NAMES;
const ROLES: [AgentRole, string][] = [
  ['lead', 'lead'],
  ['coder', 'coder 1'],
  ['coder', 'coder 2'],
  ['critic', 'critic'],
  ['scout', 'scout'],
  ['tester', 'tester'],
];
/**
 * Model per role (lead, coder 1, coder 2, critic, scout, tester). Each project draws one mix by seed, so
 * stations differ the way real teams do. Every mix keeps one premium seat, so spend per hour stays close.
 */
const MODEL_MIXES: ModelFamily[][] = [
  ['fable', 'sonnet', 'astra', 'opus', 'haiku', 'sonnet'],
  ['opus', 'sonnet', 'sonnet', 'astra', 'haiku', 'haiku'],
  ['fable', 'astra', 'astra', 'sonnet', 'haiku', 'sonnet'],
  ['sonnet', 'sonnet', 'haiku', 'opus', 'haiku', 'astra'],
  ['fable', 'sonnet', 'sonnet', 'sonnet', 'astra', 'haiku'],
  ['opus', 'astra', 'sonnet', 'sonnet', 'sonnet', 'haiku'],
];
/** Each project's stack: where its code lives and how it is checked, so tool targets read like that repo. */
interface Stack {
  dir: string;
  ext: string;
  test: string[];
  build: string[];
  /** files the scout and lead read besides the task brief */
  docs: string[];
  /** files a task touches besides its main one (its test, shared types), by slug */
  related: (slug: string) => string[];
}
const STACKS: Stack[] = [
  {
    dir: 'internal/api',
    ext: '.go',
    test: ['go test ./...', 'go test ./internal/api/...', 'go vet ./...'],
    build: ['go build ./...', 'golangci-lint run'],
    docs: ['README.md', 'api/openapi.yaml', 'docs/errors.md'],
    related: (slug) => [`internal/api/${slug}_test.go`, 'internal/api/types.go', 'internal/api/errors.go'],
  },
  {
    dir: 'src/components',
    ext: '.tsx',
    test: ['vitest run', 'vitest run src/components', 'playwright test --project=chromium'],
    build: ['npm run build', 'npm run lint', 'tsc --noEmit'],
    docs: ['README.md', 'src/tokens/README.md', 'DESIGN.md'],
    related: (slug) => [
      `src/components/${slug}.test.tsx`,
      'src/components/index.ts',
      'src/styles/tokens.css',
    ],
  },
  {
    dir: 'src/cmd',
    ext: '.rs',
    test: ['cargo test', 'cargo test --test cli', 'cargo test -- --nocapture'],
    build: ['cargo build', 'cargo clippy -- -D warnings', 'cargo fmt --check'],
    docs: ['README.md', 'docs/flags.md', 'Cargo.toml'],
    related: () => ['src/cmd/mod.rs', 'src/main.rs', 'tests/cli.rs'],
  },
  {
    dir: 'crates/storage/src',
    ext: '.rs',
    test: ['cargo test -p storage', 'cargo test -p storage --release', 'cargo bench --no-run'],
    build: ['cargo check --workspace', 'cargo clippy --workspace'],
    docs: ['README.md', 'docs/format.md', 'ARCHITECTURE.md'],
    related: () => [
      'crates/storage/src/lib.rs',
      'crates/storage/src/page.rs',
      'crates/storage/tests/recovery.rs',
    ],
  },
  {
    dir: 'docs',
    ext: '.mdx',
    test: ['npm run lint:links', 'npm run check:spelling', 'npm run test:examples'],
    build: ['npm run build', 'npm run preview -- --strict'],
    docs: ['README.md', 'docs/_sidebar.json', 'STYLE.md'],
    related: (slug) => ['docs/_sidebar.json', `docs/${slug}/index.mdx`, 'docs/snippets/install.mdx'],
  },
  {
    dir: 'pulsar',
    ext: '.py',
    test: ['pytest -q', 'pytest -q tests/unit', 'pytest -q -k smoke'],
    build: ['ruff check .', 'mypy pulsar'],
    docs: ['README.md', 'pyproject.toml', 'notebooks/README.md'],
    related: (slug) => [`tests/test_${slug.replace(/-/g, '_')}.py`, 'pulsar/config.py', 'pulsar/types.py'],
  },
];
/** What the lead reads or updates after a task lands (Read / Edit pairs). */
const LEAD_NOTES: [string, string][] = [
  ['Read', 'HANDOFF.md'],
  ['Edit', 'STATUS.md'],
  ['Read', 'PLAN.md'],
  ['Edit', 'CHANGELOG.md'],
  ['Bash', 'git log --oneline -5'],
  ['Read', 'DECISIONS.md'],
];
const SLUGS: string[][] = [
  [
    'schema',
    'auth',
    'router',
    'rate-limit',
    'handlers',
    'errors',
    'openapi',
    'pagination',
    'cache',
    'webhooks',
    'metrics',
    'checks',
    'docs',
    'release',
  ],
  [
    'tokens',
    'layout',
    'widget',
    'forms',
    'a11y',
    'theme',
    'charts',
    'routing',
    'empty-states',
    'motion',
    'i18n',
    'checks',
    'docs',
    'release',
  ],
  [
    'parser',
    'flags',
    'config',
    'prompts',
    'output',
    'completions',
    'errors',
    'update',
    'telemetry-off',
    'man-page',
    'packaging',
    'checks',
    'docs',
    'release',
  ],
  [
    'schema',
    'migrations',
    'indexes',
    'wal',
    'compaction',
    'snapshots',
    'replication',
    'vacuum',
    'bench',
    'backup',
    'pooling',
    'checks',
    'docs',
    'release',
  ],
  [
    'outline',
    'quickstart',
    'reference',
    'examples',
    'search',
    'nav',
    'versioning',
    'redirects',
    'diagrams',
    'glossary',
    'links',
    'checks',
    'faq',
    'release',
  ],
  [
    'dataset',
    'features',
    'trainer',
    'eval',
    'metrics',
    'export',
    'serving',
    'batching',
    'drift',
    'tuning',
    'cards',
    'checks',
    'docs',
    'release',
  ],
];
/** What each project's armies work on, one theme per run (fictional products, no real names). */
const THEMES: string[][] = [
  [
    'Billing webhooks v2',
    'Rate limiter rollout',
    'Cursor pagination for orders',
    'Session token rotation',
    'OpenAPI 3.1 migration',
  ],
  [
    'Design tokens refresh',
    'Settings page rebuild',
    'Accessible date picker',
    'Dark mode polish',
    'Usage charts',
  ],
  ['Config file v2', 'Shell completions', 'Interactive init', 'Self-update channel', 'JSON output mode'],
  ['Online index builds', 'WAL compaction', 'Snapshot restore', 'Read replicas', 'Connection pooling'],
  [
    'Quickstart rewrite',
    'Reference generator',
    'Versioned docs',
    'Search relevance',
    'Architecture diagrams',
  ],
  ['Eval harness', 'Feature backfill', 'Batch inference', 'Drift monitoring', 'Model cards'],
];
/** PR titles per task slug; the PR number picks a variant. */
const PR_TITLES: Record<string, [string, string]> = {
  schema: ['Tighten request schema validation', 'Version the storage schema'],
  auth: ['Rotate session tokens on privilege change', 'Reject expired API keys early'],
  router: ['Split the router by resource', 'Add route-level timeouts'],
  'rate-limit': ['Token-bucket rate limiting for public routes', 'Return Retry-After on 429s'],
  handlers: ['Move handlers onto the shared error envelope', 'Trim duplicate handler middleware'],
  errors: ['Consistent error codes across commands', 'Surface root causes in error messages'],
  openapi: ['Generate OpenAPI from route types', 'Publish OpenAPI examples for every endpoint'],
  pagination: ['Cursor pagination for list endpoints', 'Stable sort keys for paginated lists'],
  cache: ['Cache hot lookups with a 60s TTL', 'Invalidate cache on writes'],
  webhooks: ['Sign outgoing webhooks', 'Retry failed webhook deliveries with backoff'],
  metrics: ['Export latency histograms', 'Track eval metrics per run'],
  checks: ['Run typecheck and lint in CI', 'Cache dependencies in CI'],
  docs: ['Document configuration options', 'Refresh README examples'],
  release: ['Prepare release notes', 'Bump version and changelog'],
  tokens: ['Introduce color and spacing tokens', 'Replace hard-coded colors with tokens'],
  layout: ['Responsive grid for the settings page', 'Fix sidebar overflow on small screens'],
  widget: ['Usage summary widget', 'Keyboard support for the widget menu'],
  forms: ['Inline validation for account forms', 'Preserve form state on navigation'],
  a11y: ['Label icon-only buttons', 'Restore focus after closing dialogs'],
  theme: ['Dark theme contrast fixes', 'Follow the system color scheme'],
  charts: ['Accessible tooltips for usage charts', 'Lazy-load chart bundles'],
  routing: ['Prefetch routes on hover', 'Typed route params'],
  'empty-states': ['Helpful empty states for lists', 'Empty state for first-run projects'],
  motion: ['Respect reduced-motion preferences', 'Shorten page transitions'],
  i18n: ['Extract UI strings for translation', 'Locale-aware number formatting'],
  parser: ['Faster argument parser', 'Better errors for unknown flags'],
  flags: ['Add --dry-run to destructive commands', 'Deprecate legacy short flags'],
  config: ['Load config from the project root', 'Validate config with clear messages'],
  prompts: ['Interactive prompts for init', 'Skip prompts when stdin is not a TTY'],
  output: ['JSON output mode', 'Align table output columns'],
  completions: ['Shell completions for bash and zsh', 'Complete profile names'],
  update: ['Self-update with checksum verification', 'Notify when a new version is available'],
  'telemetry-off': ['Telemetry off by default', 'Document the telemetry opt-in'],
  'man-page': ['Generate man pages from help text', 'Add examples to man pages'],
  packaging: ['Build static binaries for arm64', 'Reproducible release archives'],
  migrations: ['Online migration for the events table', 'Make migrations idempotent'],
  indexes: ['Build indexes without blocking writes', 'Drop unused indexes'],
  wal: ['Batch WAL fsyncs', 'Checksum WAL segments'],
  compaction: ['Leveled compaction for cold data', 'Throttle compaction under load'],
  snapshots: ['Incremental snapshots', 'Verify snapshots on restore'],
  replication: ['Read replicas with bounded lag', 'Resume replication after failover'],
  vacuum: ['Background vacuum scheduling', 'Report vacuum progress'],
  bench: ['Benchmark suite for point reads', 'Track write amplification in benchmarks'],
  backup: ['Point-in-time backup restore', 'Encrypt backups at rest'],
  pooling: ['Connection pool with idle timeouts', 'Fair queueing for pooled connections'],
  outline: ['Restructure the docs outline', 'Merge duplicate guides'],
  quickstart: ['Rewrite the quickstart', 'Five-minute quickstart for the CLI'],
  reference: ['Generate API reference pages', 'Link reference pages to source'],
  examples: ['Runnable examples for common tasks', 'Test docs examples in CI'],
  search: ['Improve docs search ranking', 'Search across all doc versions'],
  nav: ['Sticky navigation for long pages', 'Breadcrumbs for nested guides'],
  versioning: ['Versioned docs for each release', 'Version switcher in the header'],
  redirects: ['Redirect moved guide URLs', 'Check redirects in CI'],
  diagrams: ['Architecture diagrams for the data path', 'Dark-mode friendly diagrams'],
  glossary: ['Add a glossary of core terms', 'Link glossary terms inline'],
  links: ['Fix broken internal links', 'Check external links weekly'],
  faq: ['FAQ for billing and limits', 'Troubleshooting FAQ'],
  dataset: ['Deduplicate the training dataset', 'Versioned dataset manifests'],
  features: ['Backfill derived features', 'Feature freshness checks'],
  trainer: ['Mixed-precision trainer', 'Resume interrupted training runs'],
  eval: ['Eval harness with held-out splits', 'Regression gate on eval scores'],
  export: ['Export models to a portable format', 'Smaller exported model artifacts'],
  serving: ['Health checks for the model server', 'Warm model replicas on deploy'],
  batching: ['Dynamic batching for inference', 'Cap batch latency at 50ms'],
  drift: ['Drift monitoring on input features', 'Alert on prediction drift'],
  tuning: ['Hyperparameter sweep config', 'Early stopping for sweeps'],
  cards: ['Model cards for released models', 'Add eval results to model cards'],
};
/** Why an army stops and asks a person: realistic approvals, not failures. */
const WAIT_REASONS = [
  'Approve the staging database migration',
  'Confirm a breaking change to a public API',
  'Allow network access for integration tests',
  'Choose between two retry strategies',
  'Approve a new runtime dependency',
  'Review a flaky test before quarantining it',
  'Grant write access to the release bucket',
];
const STEP_MS = 800;
const MAX_CATCH_UP_MS = 120_000;
const HOUR_MS = 3_600_000;
const MAX_HISTORY_MS = 12 * HOUR_MS;
const WARMUP_FRAME_MS = 60_000;
const MAX_FRAMES = 720;
/**
 * History keeps two bounded rings: frequent low-value events (moves, tool calls, status churn) for the
 * recent past, and everything else for the full 12h window, so replay of a pre-simulated night is never
 * empty at the start. ~28k events total stays well under 10MB.
 */
const MAX_DETAIL_EVENTS = 12_000;
const MAX_NOTABLE_EVENTS = 16_000;
const DETAIL_KINDS = new Set<FleetEvent['kind']>([
  'agent.move',
  'agent.tool',
  'agent.status',
  'agent.spawn',
  'task.state',
]);

class EventRing {
  private readonly items: (FleetEvent | undefined)[];
  private readonly orders: number[];
  start = 0;
  count = 0;
  constructor(private readonly capacity: number) {
    this.items = new Array<FleetEvent | undefined>(capacity);
    this.orders = new Array<number>(capacity).fill(0);
  }
  push(event: FleetEvent, order: number): void {
    const slot = (this.start + this.count) % this.capacity;
    this.items[slot] = event;
    this.orders[slot] = order;
    if (this.count < this.capacity) this.count++;
    else this.start = (this.start + 1) % this.capacity;
  }
  prune(before: number): void {
    while (this.count > 0 && this.items[this.start]!.ts < before) {
      this.items[this.start] = undefined;
      this.start = (this.start + 1) % this.capacity;
      this.count--;
    }
  }
  at(index: number): { event: FleetEvent; order: number } {
    const slot = (this.start + index) % this.capacity;
    return { event: this.items[slot]!, order: this.orders[slot]! };
  }
}
/** Ended sessions kept individually; older ones fold into one per-project, per-day rollup. */
const MAX_ENDED_SESSIONS = 12;
const ROLLUP_RETENTION_MS = 36 * HOUR_MS;
const LEDGER_RETENTION_MS = 24 * HOUR_MS;
/**
 * Needs-you waits are scheduled fleet-wide, one at a time: each lasts 5-45 min, and consecutive waits
 * start 185-232 min apart (start to start; an army reaches its next checkpoint within a minute or two,
 * so real spacing stays under 240 min). Any rolling 12h window therefore holds 3 or 4 scheduled waits,
 * plus at most one more for the wait left open at load: 3-5 incidents per night.
 */
const MINUTE_MS = 60_000;
const waitLength = (random: () => number) => 5 * MINUTE_MS + Math.floor(random() * 40 * MINUTE_MS);
const waitSpacing = (random: () => number) => 185 * MINUTE_MS + Math.floor(random() * 47 * MINUTE_MS);
const between = (random: () => number, minMinutes: number, maxMinutes: number) =>
  Math.floor((minMinutes + random() * (maxMinutes - minMinutes)) * MINUTE_MS);
/**
 * Business pace is scheduled in clock time, separate from the fast visual task loop: about one PR per
 * lane per hour (~20 per 8h), 1-3 CI failures and 0-2 releases per night, a deploy every 50-110 min.
 * Tool calls are priced at TOKEN_SCALE so the fleet burns ~$3/hour while active (~$40/day).
 */
const TOKEN_SCALE = 0.155;
/** Work time after a stage, [min, max) ms: read 3, edit 4, test 6, review 9, branch checks 11. */
const HOLD_MS: Record<number, [number, number]> = {
  3: [0, 8_000],
  4: [3_000, 24_000],
  6: [3_000, 18_000],
  9: [2_000, 14_000],
  11: [0, 6_000],
};
/** Chance per turn that the agent mid-step makes another tool call. */
const HOLD_CALL_CHANCE = 0.7;
const prTitle = (slug: string, number: number): string =>
  PR_TITLES[slug]?.[number % 2] ?? `Improve ${slug.replace(/-/g, ' ')}`;

interface PrJob {
  projectId: string;
  number: number;
  phase: 'ci' | 'repair' | 'merge';
  ciAt: number;
  repairAt: number;
  mergeAt: number;
  fail: boolean;
  commits: number;
  /** waits hours for a human merge */
  held: boolean;
}

/** Model id used when pricing a synthetic agent of the given family. */
export function demoModelId(family: ModelFamily): string {
  return family === 'astra' ? 'gpt-demo' : `claude-${family}`;
}

const utcDayStart = (at: number): number => at - (((at % 86_400_000) + 86_400_000) % 86_400_000);

/** Synthetic overnight digest in the `overnight.digest/v1` shape consumed by the web Overnight panel. */
export interface DemoDigest {
  schema: 'overnight.digest/v1';
  id: string;
  generatedAt: string;
  window: { since: string; until: string };
  headline: string;
  totals: {
    projectsActive: number;
    mergedPRs: number;
    commits: number;
    releases: number;
    ciFailures: number;
    openPRsNeedingAttention: number;
    issuesOpened: number;
    issuesClosed: number;
    deployments: number;
    deploymentsFailed: number;
    starsDelta: number;
    agentContributions: number;
  };
  projects: {
    id: string;
    name: string;
    summary: string;
    health: 'red' | 'yellow' | 'green' | 'quiet';
    mergedPRs: { number: number; title: string; url: string; at: string }[];
    releases: { tag: string; name: string; url: string; at: string }[];
    ciFailures: { runId: number; workflow: string; branch: string; url: string; at: string }[];
  }[];
}

export interface SyntheticFleet extends DemoFleet {
  /** Digest of the `hours` (default 8, max 12) ending at the current clock, from the same simulation. */
  overnight(hours?: number): DemoDigest;
}

export interface DemoFleetOptions {
  seed?: number;
  now?: number;
  projects?: number;
  /** Hours simulated before `now` at creation (default 12, max 12) so the fleet has a past at first paint. */
  warmupHours?: number;
  /** Start of the day containing `at`; ended sessions roll up per day. Default UTC midnight. */
  startOfDay?: (at: number) => number;
}

interface LedgerEntry {
  at: number;
  projectId: string;
  kind: 'merge' | 'release' | 'ci.failed' | 'deploy' | 'commit';
  number?: number;
  title?: string;
  tag?: string;
}

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
  /** clock time at which a waiting army resumes */
  waitUntil: number;
  /** task state restored when the wait ends */
  resumeState: OrchTask['state'];
  /** PR opened for the current task, or 0 when the task lands on the army branch only */
  prNumber: number;
  /** clock time before which the army is mid-step (thinking, editing, running tests) */
  holdUntil: number;
}

function copySnapshot(state: FleetSnapshot, generatedAt = state.generatedAt): FleetSnapshot {
  // Explicit copies keep history frames isolated without serializing the entire fleet.
  return {
    ...state,
    generatedAt,
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

function copyEvent(event: FleetEvent): FleetEvent {
  return {
    ...event,
    ...(event.data ? { data: { ...event.data } } : {}),
    ...(event.to ? { to: { ...event.to } } : {}),
  };
}

/**
 * Purely synthetic metadata; dt and all timestamps are in milliseconds. On creation the fleet simulates
 * `warmupHours` before `now`, so PRs, releases, deploys, cost and history exist at first paint, and
 * exactly one army is left waiting on the user.
 */
export function createDemoFleet(opts: DemoFleetOptions = {}): SyntheticFleet {
  const seed = opts.seed ?? 42;
  const projectCount = opts.projects ?? 6;
  const warmupHours = opts.warmupHours ?? 12;
  const startOfDay = opts.startOfDay ?? utcDayStart;
  const createdAt = opts.now ?? Date.now();
  if (!Number.isFinite(seed) || !Number.isFinite(createdAt)) {
    throw new RangeError('seed and now must be finite');
  }
  if (!Number.isInteger(projectCount) || projectCount < 1 || projectCount > 24) {
    throw new RangeError('projects must be an integer between 1 and 24');
  }
  if (!Number.isFinite(warmupHours) || warmupHours < 0 || warmupHours > 12) {
    throw new RangeError('warmupHours must be between 0 and 12');
  }
  // Whole steps, so the live step grid lands exactly on `createdAt`.
  const warmupMs = Math.round((warmupHours * HOUR_MS) / STEP_MS) * STEP_MS;
  const origin = createdAt - warmupMs;
  const random = mulberry32(seed);
  // Cosmetic choices (model mix, tool targets, step pacing) draw from their own stream by seed.
  const vary = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(vary() * items.length)]!;
  let now = origin;
  let nextStep = now + STEP_MS;
  let sequence = 0;
  let alertSeq = 0;
  let turn = 0;
  let runs = 0;
  const historyFrames: FleetSnapshot[] = [];
  const detailEvents = new EventRing(MAX_DETAIL_EVENTS);
  const notableEvents = new EventRing(MAX_NOTABLE_EVENTS);
  let eventOrder = 0;
  const ledger: LedgerEntry[] = [];
  const rollups = new Set<string>();
  const state: FleetSnapshot = {
    version: 1,
    demo: true,
    generatedAt: now,
    projects: Array.from({ length: projectCount }, (_, index) => {
      const name = NAMES[index % NAMES.length]! + (index >= NAMES.length ? `-${index + 1}` : '');
      return {
        id: name,
        name,
        // Never shown in the UI; the /synthetic/ root marks demo data as not from this machine.
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

  // A seeded shuffle, so up to six projects each get a different model mix.
  const mixes = [...MODEL_MIXES];
  for (let index = mixes.length - 1; index > 0; index--) {
    const other = Math.floor(vary() * (index + 1));
    [mixes[index], mixes[other]] = [mixes[other]!, mixes[index]!];
  }

  function start(project: Project, generation: number): Army {
    // Fleet-wide run numbers: two lanes can reach one project at the same generation, never the same run.
    const id = `${project.id}:run-${runs++}`;
    const projectIndex = state.projects.indexOf(project);
    const slugs = SLUGS[projectIndex % SLUGS.length]!;
    const themes = THEMES[projectIndex % THEMES.length]!;
    const count = 8 + Math.floor(random() * 7);
    // Vary the DAG per run: a chain, a fan-out/fan-in, or layers of parallel work.
    const shape = Math.floor(random() * 3);
    const width = 2 + Math.floor(random() * 2);
    const taskId = (index: number) => `t${String(index + 1).padStart(2, '0')}`;
    const tasks: OrchTask[] = Array.from({ length: count }, (_, index) => {
      let depends: number[] = [];
      if (shape === 0) depends = index < 2 ? [] : [index - 1];
      else if (shape === 1)
        depends = index === 0 ? [] : index === count - 1 ? [index - 3, index - 2, index - 1] : [0];
      else if (index >= width) {
        const previous = (Math.floor(index / width) - 1) * width;
        depends = [previous + Math.floor(random() * width)];
        if (random() < 0.5) depends.push(previous + Math.floor(random() * width));
      }
      return {
        id: taskId(index),
        slug: slugs[index % slugs.length]!,
        depends: [...new Set(depends)].sort((a, b) => a - b).map(taskId),
        route: index % 2 ? 'gpt_code' : 'claude_code',
        risk: random() < 0.15 ? 'high' : 'normal',
        state: 'queued',
      };
    });
    project.orch = {
      projectId: project.id,
      branch: `orch/run-${generation}`,
      phase: 'running',
      statusText: '',
      handoffText: '',
      tasks,
      inflight: [],
      worktrees: tasks.map((task) => task.id),
      blocked: [],
      updatedAt: now,
    };
    const mix = mixes[projectIndex % mixes.length]!;
    const agents: Agent[] = ROLES.map(([role, label], index) => ({
      id: index === 0 ? id : `${id}:a${index}`,
      sessionId: id,
      projectId: project.id,
      role,
      model: index === 0 && generation % 2 ? 'opus' : mix[index]!,
      label: index === 0 ? `${project.name} ${label}` : label,
      status: 'idle',
      location: { kind: 'project', projectId: project.id },
      tokens: { ...ZERO_TOKENS },
      startedAt: now,
      lastActivity: now,
    }));
    const session: Session = {
      id,
      projectId: project.id,
      title: themes[generation % themes.length]!,
      model: agents[0]!.model,
      startedAt: now,
      lastActivity: now,
      status: 'active',
      tokens: { ...ZERO_TOKENS },
      costUsd: 0,
      toolCalls: 0,
      agentIds: agents.map((agent) => agent.id),
      gitBranch: project.orch.branch,
    };
    state.sessions.push(session);
    state.agents.push(...agents);
    return {
      project,
      session,
      agents,
      generation,
      taskIndex: 0,
      stage: 0,
      waiting: false,
      waitUntil: 0,
      resumeState: 'queued',
      prNumber: 0,
      holdUntil: 0,
    };
  }

  /** Fold an ended session into its project's rollup for that day, keeping cost and tokens. */
  function fold(old: Session): void {
    const id = `${old.projectId}:earlier-${startOfDay(old.startedAt)}`;
    let rollup = state.sessions.find((entry) => entry.id === id);
    if (!rollup) {
      const name = state.projects.find((project) => project.id === old.projectId)?.name ?? 'project';
      rollup = {
        id,
        projectId: old.projectId,
        title: `Earlier ${name} runs`,
        model: old.model,
        startedAt: old.startedAt,
        lastActivity: old.lastActivity,
        status: 'ended',
        tokens: { ...ZERO_TOKENS },
        costUsd: 0,
        toolCalls: 0,
        agentIds: [],
      };
      rollups.add(id);
      state.sessions.push(rollup);
    }
    rollup.tokens = addTokens(rollup.tokens, old.tokens);
    rollup.costUsd += old.costUsd;
    rollup.toolCalls += old.toolCalls;
    rollup.startedAt = Math.min(rollup.startedAt, old.startedAt);
    rollup.lastActivity = Math.max(rollup.lastActivity, old.lastActivity);
    state.sessions = state.sessions.filter((entry) => entry !== old);
  }

  /** Ended sessions stay listed (and counted in today's cost); their agents leave the harbour. */
  function archive(session: Session): void {
    session.status = 'ended';
    session.agentIds = [];
    state.agents = state.agents.filter((agent) => agent.sessionId !== session.id);
    const ended = state.sessions.filter((entry) => entry.status === 'ended' && !rollups.has(entry.id));
    for (const old of ended.slice(0, Math.max(0, ended.length - MAX_ENDED_SESSIONS))) fold(old);
    state.sessions = state.sessions.filter((entry) => {
      if (!rollups.has(entry.id) || entry.lastActivity >= now - ROLLUP_RETENTION_MS) return true;
      rollups.delete(entry.id);
      return false;
    });
  }

  const armies = state.projects.slice(0, Math.min(3, projectCount)).map((project) => start(project, 0));
  // One fleet-wide wait schedule (not per lane), so needs-you incidents stay rare and never overlap.
  let nextWaitAt = origin + between(random, 40, 120);
  const nextPrAt = armies.map(() => origin + between(random, 5, 60));
  let nextCiFailAt = origin + between(random, 60, 240);
  let nextDeployAt = origin + between(random, 20, 90);
  let nextReleaseAt = origin + between(random, 120, 360);
  const prJobs: PrJob[] = [];
  const prCounter = new Map(state.projects.map((project, index) => [project.id, 120 + index * 47]));
  const releaseCounter = new Map(state.projects.map((project, index) => [project.id, 3 + index]));

  /** Advance open PRs through CI, repair and merge on the clock; merges may ship a deploy or release. */
  function business(events: FleetEvent[]): void {
    for (const job of [...prJobs]) {
      const project = state.projects.find((entry) => entry.id === job.projectId)!;
      const pr = state.prs.find((entry) => entry.projectId === job.projectId && entry.number === job.number);
      if (!pr) {
        prJobs.splice(prJobs.indexOf(job), 1);
        continue;
      }
      const session = state.sessions.find(
        (entry) => entry.projectId === project.id && entry.agentIds.length > 0,
      );
      const emit = (
        kind: FleetEvent['kind'],
        label: string,
        severity: FleetEvent['severity'],
        data: FleetEvent['data'],
      ) =>
        events.push({
          id: `${now}-${sequence++}`,
          ts: now,
          kind,
          projectId: project.id,
          ...(session ? { sessionId: session.id } : {}),
          severity,
          label,
          data,
        });
      const record = (
        kind: LedgerEntry['kind'],
        extra: Omit<LedgerEntry, 'at' | 'projectId' | 'kind'> = {},
      ) => ledger.push({ at: now, projectId: project.id, kind, ...extra });
      if (job.phase === 'ci' && now >= job.ciAt) {
        pr.ci = job.fail ? 'failure' : 'success';
        pr.updatedAt = now;
        emit('ci', job.fail ? 'CI failed' : 'CI passed', job.fail ? 'error' : 'success', {
          state: pr.ci,
          number: pr.number,
        });
        // The army repairs its own red CI (see 'repair'), so a failure is recorded and shown on the PR
        // but raises no needs-you alert: the only incidents are the scheduled waits (3-5 a night).
        if (job.fail) record('ci.failed', { number: pr.number, title: pr.headRef });
        job.phase = job.fail ? 'repair' : 'merge';
      } else if (job.phase === 'repair' && now >= job.repairAt) {
        pr.ci = 'success';
        pr.updatedAt = now;
        record('commit');
        emit('ci', 'CI repaired', 'success', { state: 'success', number: pr.number });
        job.phase = 'merge';
      } else if (job.phase === 'merge' && now >= job.mergeAt) {
        pr.state = 'merged';
        pr.updatedAt = now;
        prJobs.splice(prJobs.indexOf(job), 1);
        record('merge', { number: pr.number, title: pr.title });
        for (let commit = 0; commit < job.commits; commit++) record('commit');
        emit('merge', `PR #${pr.number} merged`, 'success', { number: pr.number });
        if (now >= nextDeployAt) {
          nextDeployAt = now + between(random, 50, 110);
          const id = `${project.id}:deploy-${pr.number}`;
          state.deploys.push({
            id,
            projectId: project.id,
            environment: 'preview',
            state: 'ready',
            createdAt: now,
          });
          state.deploys = state.deploys.slice(-12);
          record('deploy');
          emit('deploy', 'Preview deployment ready', 'success', { state: 'ready', id });
        }
        if (now >= nextReleaseAt) {
          nextReleaseAt = now + between(random, 270, 480);
          const minor = releaseCounter.get(project.id)! + 1;
          releaseCounter.set(project.id, minor);
          const tag = `v1.${minor}.0`;
          state.releases.push({
            projectId: project.id,
            tag,
            name: `${project.name} ${tag}`,
            url: `https://example.invalid/${project.name}/releases/${tag}`,
            publishedAt: now,
          });
          state.releases = state.releases.slice(-12);
          record('release', { tag });
          emit('release', `${tag} released`, 'success', { tag });
        }
      }
    }
  }

  function context(army: Army, events: FleetEvent[]) {
    const { project, session, agents } = army;
    const orch = project.orch!;
    const task = orch.tasks[army.taskIndex]!;
    const lead = agents[0]!;
    const coder = agents[1 + (army.taskIndex % 2)]!;
    const reason = WAIT_REASONS[(army.generation * 3 + army.taskIndex) % WAIT_REASONS.length]!;

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
    function taskState(value: OrchTask['state']): void {
      task.state = value;
      emit('task.state', `${task.id} ${value}`, coder, value === 'landed' ? 'success' : 'info', {
        state: value,
      });
    }
    function alert(kind: 'session.waiting' | 'army.blocked', body: string): void {
      // Structured subject, so the dashboard folds both alerts into the one incident for this task.
      state.alerts.push({
        id: `alert-${now}-${alertSeq++}`,
        kind,
        projectId: project.id,
        title: kind,
        body,
        at: now,
        taskId: task.id,
        sessionId: session.id,
      });
      state.alerts = state.alerts.slice(-12);
    }
    function record(
      kind: LedgerEntry['kind'],
      extra: Omit<LedgerEntry, 'at' | 'projectId' | 'kind'> = {},
    ): void {
      ledger.push({ at: now, projectId: project.id, kind, ...extra });
    }
    function beginWait(durationMs: number): void {
      army.waiting = true;
      army.waitUntil = now + durationMs;
      army.resumeState = task.state === 'blocked' ? 'running' : task.state;
      session.status = 'waiting';
      session.lastActivity = now;
      coder.status = 'waiting';
      // the coder waits on this task even when the wait opens before it was dispatched (settled at load)
      coder.currentTask = task.id;
      taskState('blocked');
      orch.phase = 'blocked';
      orch.blocked = [task.id];
      emit('session.waiting', `Needs you: ${reason.toLowerCase()}`, coder, 'warn');
      emit('blocked', `${task.id} paused until you reply`, coder, 'warn');
      alert('session.waiting', `${reason} (${task.id} ${task.slug})`);
      alert('army.blocked', `${session.title} is paused until you reply`);
    }
    function endWait(): void {
      army.waiting = false;
      project.lastActivity = session.lastActivity = orch.updatedAt = now;
      session.status = 'active';
      coder.status = 'working';
      orch.phase = 'running';
      orch.blocked = [];
      taskState(army.resumeState);
      for (const entry of state.alerts) if (entry.projectId === project.id) entry.cleared = true;
      emit('agent.status', 'Approved, resuming', coder, 'info', { status: 'working' });
    }
    return {
      project,
      session,
      agents,
      orch,
      task,
      lead,
      coder,
      emit,
      taskState,
      alert,
      record,
      beginWait,
      endWait,
    };
  }

  /** How long the work after a stage takes: reading and editing, test runs and review are not instant. */
  function holdAfter(stage: number): number {
    const span = HOLD_MS[stage];
    return span ? Math.floor(span[0] + vary() * (span[1] - span[0])) : 0;
  }

  function advance(army: Army, events: FleetEvent[]): void {
    const ctx = context(army, events);
    if (army.waiting) {
      // A waiting army stays quiet until its wait ends; resuming takes its turn.
      if (now >= army.waitUntil) ctx.endWait();
      return;
    }
    const { project, session, agents, orch, task, lead, coder, emit, taskState, record } = ctx;
    const critic = agents[3]!;
    const scout = agents[4]!;
    const tester = agents[5]!;
    const stack = STACKS[state.projects.indexOf(project) % STACKS.length]!;
    const file = `${stack.dir}/${task.slug}${stack.ext}`;
    const related = () => pick(stack.related(task.slug));

    function move(agent: Agent, kind: AgentLocation['kind'], ref?: string): void {
      agent.location = { kind, projectId: project.id, ...(ref ? { ref } : {}) };
      agent.currentTask = kind === 'project' ? undefined : task.id;
      agent.status = 'working';
      emit('agent.move', `${agent.role} → ${kind}`, agent, 'info', undefined, agent.location);
    }
    function tool(agent: Agent, name: string, target: string, scale = 1): void {
      const usage = {
        input: Math.round((180 + Math.floor(random() * 650)) * scale * TOKEN_SCALE),
        output: Math.round((60 + Math.floor(random() * 240)) * scale * TOKEN_SCALE),
        cacheRead: Math.round((400 + Math.floor(random() * 1600)) * scale * TOKEN_SCALE),
        cacheWrite: Math.round(80 * scale * TOKEN_SCALE),
      };
      agent.tokens = addTokens(agent.tokens, usage);
      session.tokens = addTokens(session.tokens, usage);
      session.costUsd += estimateCostUsd(demoModelId(agent.model), usage);
      agent.lastTool = { name, target, at: now };
      session.lastTool = { ...agent.lastTool };
      session.toolCalls++;
      emit('agent.tool', `${name} ${target}`, agent, 'info', { name, target });
    }
    if (now < army.holdUntil) {
      // Mid-step: the agent on it sometimes makes another call, so steps take uneven, believable time.
      if (vary() < HOLD_CALL_CHANCE) {
        project.lastActivity = session.lastActivity = orch.updatedAt = now;
        const done = army.stage - 1;
        if (done === 6 || done === 11) tool(tester, 'Bash', pick(stack.test));
        else if (done === 9) tool(critic, 'Read', related());
        else tool(coder, pick(['Read', 'Edit', 'Edit']), pick([file, related()]));
      }
      return;
    }
    project.lastActivity = session.lastActivity = orch.updatedAt = now;
    const stageRun = army.stage;
    switch (army.stage++) {
      case 0:
        if (army.taskIndex === 0) emit('session.start', `Army started: ${session.title}`);
        // The lead reads the task brief before dispatching, so the lead's own usage is never zero.
        tool(lead, 'Read', `TASKS/${task.id}-${task.slug}.md`, 2);
        emit('agent.spawn', `${coder.role} assigned ${task.id}`, coder);
        taskState('running');
        orch.inflight = [
          {
            task: task.id,
            role: coder.role,
            agent: coder.id,
            worktree: task.id,
            baseSha: '0000000',
            started: formatLocalTime(now),
          },
        ];
        move(coder, 'task', task.id);
        break;
      case 1:
        move(scout, 'task', task.id);
        tool(scout, 'Read', pick(stack.docs));
        break;
      case 2:
        move(coder, 'worktree', task.id);
        break;
      case 3:
        tool(coder, 'Read', file);
        break;
      case 4:
        tool(coder, 'Edit', file);
        break;
      case 5:
        if (now >= nextWaitAt && !armies.some((other) => other.waiting)) {
          const length = waitLength(random);
          ctx.beginWait(length);
          nextWaitAt = now + waitSpacing(random);
        } else tool(coder, 'Bash', pick(stack.build));
        break;
      case 6:
        move(tester, 'worktree', task.id);
        tool(tester, 'Bash', pick(stack.test));
        break;
      case 7:
        emit('test.run', 'Unit tests passed', tester, 'success', { passed: 12, failed: 0 });
        break;
      case 8: {
        taskState('review');
        army.prNumber = 0;
        const lane = armies.indexOf(army);
        // Most tasks land on the army branch; about once an hour per lane the lead ships a PR.
        if (now >= nextPrAt[lane]!) {
          nextPrAt[lane] = now + between(random, 40, 80);
          const number = prCounter.get(project.id)! + 1;
          prCounter.set(project.id, number);
          const fail = now >= nextCiFailAt;
          if (fail) nextCiFailAt = now + between(random, 170, 330);
          const ciAt = now + between(random, 4, 12);
          const repairAt = fail ? ciAt + between(random, 20, 80) : ciAt;
          // Some PRs wait for a human merge for a few hours, so several are open at any time; while fewer
          // than two wait, the next one does too, so the open list never empties.
          const waiting = prJobs.filter((job) => job.held).length;
          const held = random() < 0.2 || waiting < 2;
          const mergeAt = repairAt + (held ? between(random, 100, 300) : between(random, 8, 40));
          const commits = 2 + Math.floor(random() * 4);
          prJobs.push({
            projectId: project.id,
            number,
            phase: 'ci',
            ciAt,
            repairAt,
            mergeAt,
            fail,
            commits,
            held,
          });
          state.prs.push({
            projectId: project.id,
            number,
            title: prTitle(task.slug, number),
            state: 'open',
            ci: 'pending',
            url: `https://example.invalid/${project.name}/pull/${number}`,
            headRef: `feat/${task.slug}`,
            updatedAt: now,
          });
          state.prs = state.prs.slice(-30);
          army.prNumber = number;
          emit('agent.status', `PR #${number} opened`, lead, 'info', { number });
        }
        move(coder, 'review', task.id);
        move(critic, 'review', task.id);
        break;
      }
      case 9:
        tool(critic, 'Read', file);
        emit('review', 'Review approved', critic, 'success', { verdict: 'approved' });
        break;
      case 10:
        taskState('landed');
        orch.inflight = [];
        if (
          army.prNumber &&
          state.prs.some((entry) => entry.projectId === project.id && entry.number === army.prNumber)
        )
          move(tester, 'ci', String(army.prNumber));
        else move(tester, 'worktree', task.id);
        break;
      case 11:
        tool(tester, 'Bash', pick(stack.test));
        break;
      case 12: {
        const [name, target] = pick<[string, string]>([
          ...LEAD_NOTES,
          ['Bash', pick(stack.build)],
          ['Read', pick(stack.docs)],
          ['Read', `TASKS/${orch.tasks[army.taskIndex + 1]?.id ?? task.id}.md`],
        ]);
        tool(lead, name, target);
        break;
      }
      case 13:
        emit('test.run', 'Branch checks passed', tester, 'success', { passed: 12, failed: 0 });
        break;
      case 14:
        emit('agent.status', `${task.id} landed on ${orch.branch}`, lead, 'info', { status: 'working' });
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
          emit('army.done', `All ${orch.tasks.length} tasks landed`, lead, 'success');
          emit('session.end', 'Session ended', lead, 'success');
          // Keep the completed army visible until its next scheduled turn.
          army.taskIndex--;
        }
        break;
      default: {
        const index = state.projects.indexOf(project);
        const next = state.projects[(index + armies.length) % projectCount]!;
        // Uneven project counts can point at another live army; keep this lane in that case.
        const destination = armies.some((other) => other !== army && other.project === next) ? project : next;
        archive(session);
        if (destination !== project) delete project.orch;
        Object.assign(army, start(destination, army.generation + 1));
        advance(army, events);
      }
    }
    if (!army.waiting) army.holdUntil = Math.max(army.holdUntil, now + holdAfter(stageRun));
  }

  function snapshot(): FleetSnapshot {
    return copySnapshot(state, now);
  }

  function rememberEvents(events: FleetEvent[], copy: boolean): void {
    for (const event of events) {
      (DETAIL_KINDS.has(event.kind) ? detailEvents : notableEvents).push(
        copy ? copyEvent(event) : event,
        eventOrder++,
      );
    }
    detailEvents.prune(now - MAX_HISTORY_MS);
    notableEvents.prune(now - MAX_HISTORY_MS);
    const stale = ledger.findIndex((entry) => entry.at >= now - LEDGER_RETENTION_MS);
    ledger.splice(0, stale < 0 ? ledger.length : stale);
  }

  function pruneFrames(): void {
    let expired = 0;
    while (expired < historyFrames.length && historyFrames[expired]!.generatedAt < now - MAX_HISTORY_MS)
      expired++;
    historyFrames.splice(0, Math.max(expired, historyFrames.length - MAX_FRAMES));
  }

  /** Leave exactly one army waiting on the user at load (when any army is mid-task). */
  function settleAtLoad(events: FleetEvent[]): void {
    const candidates = armies.filter(
      (army) => army.session.status !== 'ended' && army.stage <= 10 && (army.stage > 0 || army.taskIndex > 0),
    );
    if (!candidates.length) return;
    // A scheduled wait already in progress is the incident left open; otherwise start one now.
    const chosen =
      candidates.find((army) => army.waiting) ?? candidates[Math.floor(random() * candidates.length)]!;
    for (const army of armies) if (army !== chosen && army.waiting) context(army, events).endWait();
    const hold = 10 * MINUTE_MS + Math.floor(random() * 20 * MINUTE_MS);
    if (chosen.waiting) {
      // Its start already set the next slot (>= 185 min after it began, well past this extension).
      chosen.waitUntil = Math.max(chosen.waitUntil, now + hold);
    } else {
      context(chosen, events).beginWait(hold);
      nextWaitAt = now + waitSpacing(random);
    }
    nextWaitAt = Math.max(nextWaitAt, chosen.waitUntil + 5 * MINUTE_MS);
  }

  // Warm-up: simulate the hours before `createdAt`, keeping a frame every minute for replay.
  historyFrames.push(copySnapshot(state, now));
  {
    const events: FleetEvent[] = [];
    while (nextStep <= createdAt) {
      now = nextStep;
      business(events);
      advance(armies[turn++ % armies.length]!, events);
      nextStep += STEP_MS;
      if ((now - origin) % WARMUP_FRAME_MS === 0) {
        rememberEvents(events, false);
        events.length = 0;
        historyFrames.push(copySnapshot(state, now));
      }
    }
    now = createdAt;
    if (warmupMs > 0) settleAtLoad(events);
    rememberEvents(events, false);
    state.generatedAt = now;
    pruneFrames();
  }

  function tick(dtMs: number): FleetEvent[] {
    if (!Number.isFinite(dtMs) || dtMs < 0 || !Number.isFinite(now + dtMs)) {
      throw new RangeError('dtMs must be finite and nonnegative');
    }
    const end = now + dtMs;
    const events: FleetEvent[] = [];
    const catchUpEnd = Math.min(end, now + MAX_CATCH_UP_MS);
    while (nextStep <= catchUpEnd) {
      now = nextStep;
      business(events);
      advance(armies[turn++ % armies.length]!, events);
      nextStep += STEP_MS;
    }
    if (nextStep <= end) nextStep += (Math.floor((end - nextStep) / STEP_MS) + 1) * STEP_MS;
    now = end;
    rememberEvents(events, true);
    const last = historyFrames.at(-1);
    if (!last || now - last.generatedAt >= 30_000) historyFrames.push(snapshot());
    pruneFrames();
    return events;
  }

  function history(hours: number): HistoryResponse {
    if (!Number.isFinite(hours) || hours < 0) throw new RangeError('hours must be finite and nonnegative');
    const from = now - Math.min(hours, 12) * HOUR_MS;
    if (hours === 0) return { from, to: now, frames: [snapshot()], events: [] };
    const frames = historyFrames
      .filter((frame) => frame.generatedAt >= from && frame.generatedAt <= now - 30_000)
      .slice(-(MAX_FRAMES - 1))
      .map((frame) => copySnapshot(frame));
    frames.push(snapshot());
    const events: FleetEvent[] = [];
    // Merge both rings back into emission order.
    let detail = 0;
    let notable = 0;
    while (detail < detailEvents.count || notable < notableEvents.count) {
      const a = detail < detailEvents.count ? detailEvents.at(detail) : undefined;
      const b = notable < notableEvents.count ? notableEvents.at(notable) : undefined;
      const next = !b || (a && a.order < b.order) ? (detail++, a!) : (notable++, b);
      if (next.event.ts >= from) events.push(copyEvent(next.event));
    }
    return { from, to: now, frames, events };
  }

  function overnight(hours = 8): DemoDigest {
    if (!Number.isFinite(hours) || hours <= 0) throw new RangeError('hours must be finite and positive');
    const from = now - Math.min(hours, 12) * HOUR_MS;
    const iso = (at: number) => new Date(at).toISOString();
    const inWindow = ledger.filter((entry) => entry.at > from && entry.at <= now);
    const count = (kind: LedgerEntry['kind'], projectId?: string) =>
      inWindow.filter((entry) => entry.kind === kind && (!projectId || entry.projectId === projectId)).length;
    const recent = (kind: LedgerEntry['kind'], projectId: string, limit: number) =>
      inWindow
        .filter((entry) => entry.kind === kind && entry.projectId === projectId)
        .slice(-limit)
        .reverse();
    const plural = (value: number, noun: string) => `${value} ${noun}${value === 1 ? '' : 's'}`;
    const projects = state.projects.map((project) => {
      const merged = count('merge', project.id);
      const releases = count('release', project.id);
      const failures = count('ci.failed', project.id);
      const deploys = count('deploy', project.id);
      const needsYou = state.alerts.some((alert) => alert.projectId === project.id && !alert.cleared);
      const redPrs = state.prs.filter(
        (entry) => entry.projectId === project.id && entry.state === 'open' && entry.ci === 'failure',
      );
      const health: DemoDigest['projects'][number]['health'] = needsYou
        ? 'red'
        : redPrs.length
          ? 'yellow'
          : merged
            ? 'green'
            : 'quiet';
      const blocked = project.orch?.blocked[0];
      const summary =
        !merged && !releases && !failures
          ? 'No activity in this window.'
          : `${plural(merged, 'PR')} merged, ${plural(releases, 'release')}, ${plural(deploys, 'deploy')}. ` +
            (needsYou
              ? blocked
                ? `${blocked} is waiting on you.`
                : redPrs.length
                  ? `CI is failing on #${redPrs[0]!.number}.`
                  : 'An alert is waiting on you.'
              : redPrs.length
                ? `PR #${redPrs[0]!.number} is open with failing checks.`
                : failures
                  ? `${failures} CI ${failures === 1 ? 'failure' : 'failures'}, all repaired.`
                  : 'CI green all window.');
      return {
        id: project.id,
        name: project.name,
        summary,
        health,
        mergedPRs: recent('merge', project.id, 4).map((entry) => ({
          number: entry.number!,
          title: entry.title!,
          url: `https://example.invalid/${project.name}/pull/${entry.number}`,
          at: iso(entry.at),
        })),
        releases: recent('release', project.id, 3).map((entry) => ({
          tag: entry.tag!,
          name: `${project.name} ${entry.tag}`,
          url: `https://example.invalid/${project.name}/releases/${entry.tag}`,
          at: iso(entry.at),
        })),
        ciFailures: recent('ci.failed', project.id, 3).map((entry) => ({
          runId: Math.floor(entry.at / 1000),
          workflow: 'checks',
          branch: entry.title!,
          url: `https://example.invalid/${project.name}/pull/${entry.number}/checks`,
          at: iso(entry.at),
        })),
      };
    });
    const merged = count('merge');
    const commits = count('commit');
    const active = projects.filter((project) => project.health !== 'quiet').length;
    const red = projects.filter((project) => project.health === 'red').map((project) => project.name);
    const yellow = projects.filter((project) => project.health === 'yellow').length;
    const number = (value: number) => value.toLocaleString('en-US');
    const headline =
      `${number(merged)} pull requests merged and ${number(commits)} commits pushed across ${active} ` +
      `${active === 1 ? 'project' : 'projects'}, all by agents.` +
      (red.length ? ` ${red.join(' and ')} ${red.length === 1 ? 'needs' : 'need'} you.` : '') +
      (yellow ? ` ${yellow} more ${yellow === 1 ? 'is' : 'are'} worth a look.` : '');
    return {
      schema: 'overnight.digest/v1',
      id: iso(now).slice(0, 10),
      generatedAt: iso(now),
      window: { since: iso(from), until: iso(now) },
      headline,
      totals: {
        projectsActive: active,
        mergedPRs: merged,
        commits,
        releases: count('release'),
        ciFailures: count('ci.failed'),
        openPRsNeedingAttention: state.prs.filter((entry) => entry.state === 'open' && entry.ci === 'failure')
          .length,
        issuesOpened: 0,
        issuesClosed: 0,
        deployments: count('deploy'),
        deploymentsFailed: 0,
        starsDelta: 0,
        agentContributions: merged,
      },
      projects,
    };
  }

  return { snapshot, tick, history, overnight };
}
