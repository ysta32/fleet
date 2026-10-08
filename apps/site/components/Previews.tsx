// Static UI previews rendered at build time from the synthetic demo fleet (lib/demo.ts).
import { Icon } from '@/components/Icon';
import { LocalTime } from '@/components/LocalTime';
import { costExample, demoPreview, fmtTok, fmtUsd, replayTape, type Incident } from '@/lib/demo';
import type { IconName } from '@fleet/ui';

const KIND_ICON: Record<Incident['kind'], { icon: IconName; tone: string }> = {
  'session.waiting': { icon: 'waiting', tone: 'status-accent' },
  'agent.waiting': { icon: 'waiting', tone: 'status-warn' },
  'army.blocked': { icon: 'blocked', tone: 'status-danger' },
  'army.done': { icon: 'check', tone: 'status-success' },
  'ci.failed': { icon: 'x', tone: 'status-danger' },
  'deploy.failed': { icon: 'x', tone: 'status-danger' },
  'spend.budget': { icon: 'cost', tone: 'status-warn' },
};

export function InboxPreview({ limit = 3 }: { limit?: number }) {
  const { inbox } = demoPreview();
  const items = inbox.slice(0, limit);
  return (
    <div>
      <div className="label-row" style={{ marginBottom: 'var(--fl-space-3)' }}>
        <span className="label">Inbox</span>
        <span className="rule" />
        <span className="label">{String(inbox.length).padStart(2, '0')} open</span>
      </div>
      <ul className="inbox" aria-label="Needs-you inbox preview, synthetic data">
        {items.map((item, i) => {
          const k = KIND_ICON[item.kind];
          return (
            <li key={item.id} data-hot={i === 0 ? '' : undefined}>
              <span className={k.tone}>
                <Icon name={k.icon} size="md" />
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="who">
                  {item.title} · {item.project}
                </span>
                <span className="what">
                  {item.detail}
                  {item.also.length ? ` · ${item.also.join(' · ')}` : ''}
                </span>
              </span>
              <span className="num" style={{ fontSize: 'var(--fl-text-xs)' }}>
                {item.minutes}m
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  active: 'status-success',
  waiting: 'status-accent',
  idle: '',
  ended: '',
};

/** The sessions table, capped: waiting first, then live work, then the rest by cost. */
export function SessionsPreview({ rows = 5 }: { rows?: number }) {
  const { sessions, totals } = demoPreview();
  const shown = sessions.slice(0, rows);
  const more = sessions.length - shown.length;
  return (
    <div>
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Sessions preview, synthetic data</caption>
          <thead>
            <tr>
              <th scope="col">Project</th>
              <th scope="col" className="col-model">
                Model
              </th>
              <th scope="col">State</th>
              <th scope="col" className="r">
                Tokens
              </th>
              <th scope="col" className="r">
                Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id}>
                <td>{s.project}</td>
                <td className="col-model">
                  <span
                    className="dot"
                    style={{ background: `var(--fl-model-${s.model})` }}
                    aria-hidden="true"
                  />
                  <span className="mono" style={{ fontSize: 'var(--fl-text-xs)' }}>
                    {s.model}
                  </span>
                </td>
                <td className={STATUS_TONE[s.status] ?? ''}>{s.status}</td>
                <td className="r">{fmtTok(s.tokens)}</td>
                <td className="r">{fmtUsd(s.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {more > 0 ? (
          <p className="table-more mono">
            +{more} more {more === 1 ? 'session' : 'sessions'}, ended or idle
          </p>
        ) : null}
      </div>
      <p className="caption mono">
        {totals.working}/{totals.agents} agents working · {totals.projects} projects · {fmtUsd(totals.cost)}{' '}
        so far
      </p>
    </div>
  );
}

export function CostMath() {
  const ex = costExample();
  return (
    <div className="math" aria-label={`Worked cost example for ${ex.modelId}`}>
      {ex.lines.map((l) => (
        <div className="math-row" key={l.label}>
          <span>
            {l.label} · {fmtTok(l.tokens)} tok · {l.rate}
          </span>
          <span>${l.usd.toFixed(4)}</span>
        </div>
      ))}
      <div className="math-row math-total">
        <span>one session, {ex.modelId}</span>
        <span>{fmtUsd(ex.total)}</span>
      </div>
      <div className="math-share" aria-hidden="true">
        {ex.lines.map((l) => (
          <span key={l.label} data-part={l.label} style={{ flexGrow: l.usd }} />
        ))}
      </div>
      <ul className="math-legend">
        {ex.lines.map((l) => (
          <li key={l.label} data-part={l.label}>
            {l.label} <b>{Math.round((l.usd / ex.total) * 100)}%</b>
          </li>
        ))}
      </ul>
      <div className="math-alt">
        <span className="label">Same tokens, other models</span>
        {ex.alternatives.map((m) => {
          const top = Math.max(...ex.alternatives.map((x) => x.usd));
          return (
            <div
              className="math-alt-row"
              key={m.label}
              data-current={m.modelId === ex.modelId ? '' : undefined}
            >
              <span>{m.label}</span>
              <span className="math-alt-bar" style={{ ['--w' as string]: `${(m.usd / top) * 100}%` }} />
              <span>{fmtUsd(m.usd)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TerminalWall() {
  const panes = [
    { t: 'aurora-api · coder', l: ['✓ 41 tests passed', 'Edit src/routes/user.ts', 'Bash npm run build'] },
    { t: 'nebula-ui · critic', l: ['Read src/Table.tsx', 'Grep "useMemo"', 'Reviewing diff…'] },
    { t: 'quasar-cli · lead', l: ['Task t07 dispatched', 'Task t08 dispatched', 'Waiting on 3 agents'] },
    {
      t: 'helix-db · coder',
      l: ['Plan ready for review.', 'Approve? (y/n)', 'idle 40m'],
      hot: true,
    },
    { t: 'orbit-docs · scout', l: ['Glob docs/**/*.md', 'Read docs/api.md', 'Summarizing…'] },
    { t: 'pulsar-ml · tester', l: ['vitest --run', '✗ 2 failed', 'Retrying'] },
  ];
  return (
    <figure style={{ margin: 0 }}>
      <div className="term-wall" aria-hidden="true">
        {panes.map((p) => (
          <div className={p.hot ? 'term term-hot' : 'term'} key={p.t}>
            <b>{p.t}</b>
            {p.l.map((line, i) => (
              <div key={i} className={p.hot && i > 0 ? 'hot' : undefined}>
                {line}
              </div>
            ))}
          </div>
        ))}
      </div>
      <figcaption className="caption">
        Illustration with invented project names. Six terminals; the one that matters is the quiet one.
      </figcaption>
    </figure>
  );
}

/**
 * A phone lock screen: the clock, then Fleet's ntfy pushes newest first. One push per incident, so a waiting
 * session, its blocked army and the agent behind them arrive as one notification, not three.
 */
export function PhonePreview() {
  const { inbox, snapshot } = demoPreview();
  // The inbox is sorted longest wait first; a lock screen shows the newest push on top.
  const stack = [...inbox].sort((a, b) => a.minutes - b.minutes).slice(0, 3);
  return (
    <div className="phone" aria-label="Phone lock screen with Fleet alerts, synthetic data" role="img">
      <div className="phone-screen">
        <span className="phone-notch" aria-hidden="true" />
        <div className="phone-clock">
          <LocalTime className="phone-date" at={snapshot.generatedAt} style="date" />
          <LocalTime className="phone-time" at={snapshot.generatedAt} style="time" />
        </div>
        <ol className="phone-stack">
          {stack.length === 0 ? (
            <li className="notif">
              <span className="notif-app">Fleet</span>
              <strong>Nothing needs you</strong>
            </li>
          ) : (
            stack.map((item, i) => (
              <li className="notif" key={item.id} data-depth={i}>
                <span className="notif-app">
                  <span className="notif-icon" aria-hidden="true" />
                  ntfy · Fleet
                  <span className="notif-when">{item.minutes}m ago</span>
                </span>
                <strong>
                  {item.title} · {item.project}
                </strong>
                <span className="notif-body">
                  {item.detail}
                  {item.also.length ? ` · ${item.also.join(' · ')}` : ''}
                </span>
              </li>
            ))
          )}
        </ol>
      </div>
    </div>
  );
}

/**
 * Replay as a tape deck: the demo world's last hours, one track per project, with the playhead part-way
 * through the night. A still built from the same synthetic world, not a recording of a real session.
 */
export function ReplayDeck() {
  const tape = replayTape();
  const head = 0.64;
  const hours = Math.round((tape.until - tape.since) / 3_600_000);
  const ticks = Array.from({ length: 5 }, (_, i) => tape.since + ((tape.until - tape.since) * i) / 4);
  const at = tape.since + (tape.until - tape.since) * head;
  const marks = tape.tracks.reduce((n, t) => n + t.marks.length, 0);
  return (
    <figure
      className="deck"
      role="img"
      aria-label={`Replay of the demo fleet's last ${hours} hours: ${tape.tracks.length} projects, ${marks} events, playhead part-way through`}
    >
      <div className="deck-top" aria-hidden="true">
        <span className="label">
          <span className="deck-rec" /> Replay · last {hours}h
        </span>
        <span className="deck-speeds">
          {['1×', '4×', '16×', '60×'].map((s) => (
            <span key={s} data-on={s === '16×' ? '' : undefined}>
              {s}
            </span>
          ))}
        </span>
      </div>
      <div className="deck-tape" aria-hidden="true">
        {tape.tracks.map((t) => (
          <div className="deck-track" key={t.project}>
            <span className="deck-name">{t.project}</span>
            <span className="deck-lane">
              {t.wait ? (
                <span
                  className="deck-wait"
                  style={{ left: `${t.wait.from * 100}%`, width: `${(t.wait.to - t.wait.from) * 100}%` }}
                />
              ) : null}
              {t.marks.map((m, i) => (
                <span key={i} className="deck-mark" data-kind={m.kind} style={{ left: `${m.x * 100}%` }} />
              ))}
            </span>
          </div>
        ))}
        <div className="deck-ruler">
          <span />
          <span className="deck-lane">
            {ticks.map((t) => (
              <LocalTime key={t} at={t} className="deck-tick" style="time" />
            ))}
          </span>
        </div>
        <div className="deck-head-rail">
          <span />
          <span className="deck-lane">
            <span className="deck-head" style={{ ['--head' as string]: String(head) }}>
              <LocalTime at={at} className="deck-head-time" style="time" />
            </span>
          </span>
        </div>
      </div>
      <div className="deck-transport" aria-hidden="true">
        <span className="deck-btn">
          <Icon name="chevron" />
        </span>
        <span className="deck-btn deck-play" />
        <span className="deck-btn deck-fwd">
          <Icon name="chevron" />
        </span>
        <span className="deck-legend">
          <i data-kind="merge" /> merged <i data-kind="ci" /> CI failed <i data-kind="release" /> release{' '}
          <i data-kind="wait" /> waiting on you
        </span>
      </div>
    </figure>
  );
}
