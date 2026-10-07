import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { FleetSnapshot, TokenUsage, ToolCallSummary } from '@fleet/shared';
import type { Selection } from '../data/contract';
import { countBy, formatElapsed, formatTokens } from './layout';
import { useSceneStore } from './store';
import { CI_COLORS, HALYARD, MODEL_COLORS, PHASE_COLORS, TASK_STATE_COLORS } from './theme';

const card: CSSProperties = {
  transform: 'translate(28px, -50%)',
  minWidth: 248,
  maxWidth: 300,
  padding: '12px 14px 12px',
  background: 'rgba(18, 21, 20, 0.92)',
  border: `1px solid ${HALYARD.borderStrong}`,
  borderRadius: HALYARD.radiusMd,
  boxShadow: '0 1px 0 rgba(255,255,255,0.04) inset, 0 24px 64px rgba(0,0,0,0.6)',
  backdropFilter: 'blur(8px)',
  color: HALYARD.fg,
  fontFamily: HALYARD.fontMono,
  fontSize: 11,
  lineHeight: 1.55,
  pointerEvents: 'auto',
  userSelect: 'none',
};
const caps: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: HALYARD.trackingCaps,
  color: HALYARD.fgSubtle,
  fontSize: 10,
};

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 16,
        borderTop: `1px solid ${HALYARD.border}`,
        padding: '3px 0',
      }}
    >
      <span style={caps}>{k}</span>
      <span style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  );
}

const sumTokens = (t: TokenUsage) => t.input + t.output + t.cacheRead + t.cacheWrite;
const toolText = (tool: ToolCallSummary | undefined, now: number) =>
  tool ? `${tool.name}${tool.target ? ' ' + tool.target : ''} · ${formatElapsed(now - tool.at)} ago` : '—';

function Header({
  title,
  kicker,
  color,
  onClose,
}: {
  title: string;
  kicker: string;
  color: string;
  onClose(): void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 8,
      }}
    >
      <div>
        <div style={{ ...caps, color }}>{kicker}</div>
        <div style={{ fontFamily: HALYARD.fontDisplay, fontSize: 22, lineHeight: 1.1, color: HALYARD.fg }}>
          {title}
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close"
        style={{
          background: 'none',
          border: `1px solid ${HALYARD.border}`,
          color: HALYARD.fgMuted,
          borderRadius: 4,
          cursor: 'pointer',
          font: 'inherit',
          padding: '0 6px',
        }}
      >
        ×
      </button>
    </div>
  );
}

function CardBody({
  sel,
  snap,
  now,
  onClose,
}: {
  sel: NonNullable<Selection>;
  snap: FleetSnapshot;
  now: number;
  onClose(): void;
}) {
  if (sel.kind === 'project') {
    const p = snap.projects.find((x) => x.id === sel.id);
    if (!p) return null;
    const agents = snap.agents.filter((a) => a.projectId === p.id);
    const sessions = snap.sessions.filter((s) => s.projectId === p.id);
    const cost = sessions.reduce((n, s) => n + s.costUsd, 0);
    const tokens = sessions.reduce((n, s) => n + sumTokens(s.tokens), 0);
    const pr = snap.prs.filter((x) => x.projectId === p.id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const counts = p.orch ? countBy(p.orch.tasks) : {};
    const color = p.orch ? PHASE_COLORS[p.orch.phase] : HALYARD.fgMuted;
    return (
      <>
        <Header
          title={p.name}
          kicker={p.orch ? `orch · ${p.orch.phase}` : 'project'}
          color={color}
          onClose={onClose}
        />
        {p.branch && <Row k="branch">{p.branch}</Row>}
        <Row k="agents">
          {agents.filter((a) => a.status === 'working').length} working / {agents.length}
        </Row>
        {p.orch && (
          <Row k="tasks">
            {(['running', 'review', 'landed', 'blocked', 'queued'] as const).map((s) =>
              counts[s] ? (
                <span key={s} style={{ color: TASK_STATE_COLORS[s], marginLeft: 8 }}>
                  {counts[s]} {s}
                </span>
              ) : null,
            )}
          </Row>
        )}
        {pr && (
          <Row k={`pr #${pr.number}`}>
            <span style={{ color: CI_COLORS[pr.ci] }}>ci {pr.ci}</span>
          </Row>
        )}
        <Row k="tokens">{formatTokens(tokens)}</Row>
        <Row k="cost">${cost.toFixed(2)}</Row>
        <Row k="last activity">{formatElapsed(now - p.lastActivity)} ago</Row>
      </>
    );
  }
  const agentId = sel.id;
  const a = snap.agents.find((x) => x.id === agentId);
  const session = snap.sessions.find((s) => s.id === (a ? a.sessionId : sel.id));
  if (!a && !session) return null;
  const model = a?.model ?? session?.model ?? 'unknown';
  const tokens = a ? a.tokens : session!.tokens;
  const started = a ? a.startedAt : session!.startedAt;
  return (
    <>
      <Header
        title={a ? a.label : (session?.title ?? 'session')}
        kicker={a ? `${a.role} · ${model} · ${a.status}` : `session · ${model} · ${session!.status}`}
        color={MODEL_COLORS[model]}
        onClose={onClose}
      />
      {a?.currentTask && <Row k="task">{a.currentTask}</Row>}
      {a && <Row k="at">{a.location.kind + (a.location.ref ? ' ' + a.location.ref : '')}</Row>}
      <Row k="last tool">{toolText(a?.lastTool ?? session?.lastTool, now)}</Row>
      <Row k="tokens">
        {formatTokens(sumTokens(tokens))}
        <span style={{ color: HALYARD.fgSubtle }}>
          {' '}
          ({formatTokens(tokens.input)} in · {formatTokens(tokens.output)} out)
        </span>
      </Row>
      {session && (
        <Row k={a && a.id !== session.id ? 'session cost' : 'cost'}>${session.costUsd.toFixed(2)}</Row>
      )}
      <Row k="elapsed">{formatElapsed(now - started)}</Row>
    </>
  );
}

/** Detail card anchored to the selected station / bot in 3D. */
export function Hud({
  selection,
  snapshot,
  replayAt,
  onClose,
}: {
  selection: Selection;
  snapshot: FleetSnapshot | null;
  /** replay playhead (epoch ms) when in replay mode; ages/elapsed are measured against it */
  replayAt: number | null;
  onClose(): void;
}) {
  const store = useSceneStore();
  const anchor = useRef<THREE.Group>(null);
  const [wallNow, setWallNow] = useState(() => Date.now());
  const now = replayAt ?? wallNow;
  const [visible, setVisible] = useState(false);
  const visRef = useRef(false);

  useEffect(() => {
    visRef.current = false;
    setVisible(false);
  }, [selection]);

  useEffect(() => {
    if (!selection || replayAt !== null) return;
    setWallNow(Date.now());
    const id = setInterval(() => setWallNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [selection, replayAt !== null]);

  useFrame(() => {
    const g = anchor.current;
    if (!g) return;
    const ok = store.selectionPosition(selection, g.position);
    if (ok !== visRef.current) {
      visRef.current = ok;
      setVisible(ok);
    }
  });

  if (!selection || !snapshot) return null;
  return (
    <group ref={anchor}>
      {visible && (
        <Html zIndexRange={[100, 50]} style={{ pointerEvents: 'none' }}>
          <div style={card} onPointerDown={(e) => e.stopPropagation()}>
            <CardBody sel={selection} snap={snapshot} now={now} onClose={onClose} />
          </div>
        </Html>
      )}
    </group>
  );
}
