import type { CSSProperties } from 'react';
import { DEMO_SUMMARY } from './demo.js';
import { SpendTab } from './SpendTab.js';

const wrap: CSSProperties = {
  maxWidth: 960,
  margin: '0 auto',
  padding: '48px 16px',
  color: 'var(--fg, #e6e6e6)',
  fontFamily: 'var(--font, system-ui, sans-serif)',
};

export function SpendSiteSection() {
  return (
    <section id="spend" style={wrap}>
      <h2 style={{ fontSize: 32, margin: '0 0 12px' }}>
        Copilot is going usage-based. Know your bill before it lands.
      </h2>
      <p style={{ fontSize: 17, lineHeight: 1.5 }}>
        On June 1, 2026 GitHub Copilot moves to usage-based billing, with model multipliers up to 9x. A $29
        plan can quietly become a $750 month. fleet-spend shows where every token went across Claude Code,
        Codex, Cursor and Copilot.
      </p>
      <p style={{ fontSize: 17, lineHeight: 1.5 }}>
        Private by design: everything runs locally. No prompts, responses or file paths ever leave your
        machine.
      </p>
      <pre
        style={{
          background: 'var(--card, #16181d)',
          border: '1px solid var(--border, #2a2d34)',
          borderRadius: 8,
          padding: 12,
          overflowX: 'auto',
        }}
      >
        <code>npx fleet-spend</code>
      </pre>
      <div style={{ marginTop: 24 }}>
        <SpendTab summary={DEMO_SUMMARY} />
      </div>
    </section>
  );
}
