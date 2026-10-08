// Static UI previews rendered at build time from the synthetic demo fleet (lib/demo.ts).
import { Icon } from '@/components/Icon';
import { costExample, demoPreview, fmtTok, fmtUsd, type InboxItem } from '@/lib/demo';
import type { IconName } from '@fleet/ui';

const KIND_ICON: Record<InboxItem['kind'], { icon: IconName; tone: string }> = {
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
                <span className="what">{item.detail}</span>
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

export function SessionsPreview() {
  const { sessions, totals } = demoPreview();
  return (
    <div>
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Sessions preview, synthetic data</caption>
          <thead>
            <tr>
              <th scope="col">Project</th>
              <th scope="col">Model</th>
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
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.project}</td>
                <td>
                  <span className="dot" style={{ background: `var(--fl-model-${s.model})` }} aria-hidden="true" />
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
      </div>
      <p className="caption mono">
        {totals.working}/{totals.agents} agents working · {totals.projects} projects · {fmtUsd(totals.cost)} so far
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

export function PhonePreview() {
  const { inbox } = demoPreview();
  const top = inbox[0];
  return (
    <div className="phone" aria-label="Phone notification preview, synthetic data" role="img">
      <div className="phone-screen">
        <span className="label" style={{ textAlign: 'center' }}>
          22:54
        </span>
        <div className="notif">
          <span className="label">ntfy · Fleet · now</span>
          <strong>{top ? `${top.title} · ${top.project}` : 'Nothing needs you'}</strong>
          <span style={{ color: 'var(--fl-fg-muted)' }}>{top ? `${top.detail}. Idle ${top.minutes}m.` : ''}</span>
        </div>
        <div className="notif" style={{ opacity: 0.6 }}>
          <span className="label">ntfy · Fleet · 12m ago</span>
          <span>Army finished · aurora-api</span>
        </div>
      </div>
    </div>
  );
}
