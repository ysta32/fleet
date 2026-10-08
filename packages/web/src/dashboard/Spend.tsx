import { useEffect, useState } from 'react';
import { SpendTab as Tab } from 'virtual:fleet-spend';

export interface SpendTabProps {
  summary: Record<string, unknown> | null | undefined;
  error?: string;
}

export function Spend() {
  const [summary, setSummary] = useState<SpendTabProps['summary']>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!Tab) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/spend', { signal: controller.signal, credentials: 'same-origin' });
        if (controller.signal.aborted) return;
        if (response.status === 404 || response.status === 204) {
          setSummary(null);
          return;
        }
        if (!response.ok) throw new Error('Spend unavailable');
        const body = await response.text();
        const data: unknown = body.trim() ? JSON.parse(body) : null;
        if (data !== null && (typeof data !== 'object' || Array.isArray(data)))
          throw new Error('Invalid spend summary');
        if (!controller.signal.aborted)
          setSummary(
            data === null || Object.keys(data).length === 0 ? null : (data as Record<string, unknown>),
          );
      } catch {
        if (!controller.signal.aborted) setError('Spend data could not be loaded. Try again in a moment.');
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  if (Tab) return <Tab summary={summary} error={error} />;
  return (
    <section
      aria-label="Spend tracking"
      style={{
        fontFamily: 'var(--fl-font-sans)',
        color: 'var(--fl-fg)',
        background: 'var(--fl-gradient-surface), var(--fl-surface-1)',
        padding: 'var(--fl-space-7)',
        border: 'var(--fl-hairline) solid var(--fl-border)',
        borderRadius: 'var(--fl-radius-lg)',
      }}
    >
      <p
        style={{
          fontFamily: 'var(--fl-font-mono)',
          color: 'var(--fl-fg-muted)',
          fontSize: 'var(--fl-text-xs)',
        }}
      >
        SPEND
      </p>
      <h2
        style={{
          fontFamily: 'var(--fl-font-display)',
          fontWeight: 400,
          fontSize: 'var(--fl-text-2xl)',
          lineHeight: 'var(--fl-leading-tight)',
        }}
      >
        Spend tracking not installed
      </h2>
      <p style={{ color: 'var(--fl-fg-muted)', maxWidth: 'var(--fl-measure)' }}>
        Connect Fleet Spend to see where your model budget goes, across projects and providers.
      </p>
    </section>
  );
}

export default Spend;
