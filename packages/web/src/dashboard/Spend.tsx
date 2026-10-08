import { useEffect, useState } from 'react';
import { DEMO_SUMMARY, SpendTab as Tab } from 'virtual:fleet-spend';
import { Icon } from '../shell/Icon';
import { CopyCommand } from '../shell/Onboarding';
import { demoSpendExample } from '../data/demoSource';

export interface SpendTabProps {
  summary: Record<string, unknown> | null | undefined;
  error?: string;
}

/**
 * The summary to show before any fetch: demo fleets use the synthetic example that ships with
 * fleet-spend (never the collector's real spend); everything else starts loading (undefined).
 */
export function initialSpend(
  demo: boolean,
  example: Record<string, unknown> | null | undefined,
): SpendTabProps['summary'] {
  return demo && example ? example : undefined;
}

/**
 * State to apply whenever the data source changes. Leaving demo resets to loading (undefined) and
 * clears any error, so synthetic numbers never linger unlabelled or survive a failed real fetch.
 */
export function spendStart(
  demo: boolean,
  example: Record<string, unknown> | null | undefined,
): { summary: SpendTabProps['summary']; error: undefined; fetch: boolean } {
  const summary = initialSpend(demo, example);
  return { summary, error: undefined, fetch: summary === undefined };
}

export function Spend({ demo = false }: { demo?: boolean }) {
  // Demo spend comes from the same synthetic fleet as the harbour; DEMO_SUMMARY only signals fleet-spend is installed.
  const example = () => (demo && DEMO_SUMMARY ? demoSpendExample() : DEMO_SUMMARY);
  const [summary, setSummary] = useState<SpendTabProps['summary']>(() => initialSpend(demo, example()));
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!Tab) return;
    const start = spendStart(demo, example());
    setSummary(start.summary);
    setError(start.error);
    if (!start.fetch) return;
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
  }, [demo]);

  if (Tab)
    return (
      <section className="dashboard spend-host" aria-label="Spend">
        <header className="panel-head">
          <h2 className="panel-title">Spend</h2>
          {demo && summary && <span className="tag">Synthetic</span>}
        </header>
        <Tab summary={summary} error={error} />
      </section>
    );
  return (
    <section className="dashboard" aria-label="Spend tracking">
      <header className="panel-head">
        <h2 className="panel-title">Spend</h2>
      </header>
      <div className="empty">
        <Icon name="cost" className="empty-icon" />
        <p className="empty-title">Spend tracking not installed</p>
        <p className="empty-body">
          Add Fleet Spend to see where your model budget goes, by day, model and project. It reads usage logs
          on this machine and never uploads them. Install it in your Fleet checkout, rebuild, then run fleet
          install to restart the collector.
        </p>
        <CopyCommand command="npm i fleet-spend" />
      </div>
    </section>
  );
}

export default Spend;
