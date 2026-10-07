import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { burnTint, DEMO_SUMMARY, SpendSiteSection, SpendTab } from './index.js';

describe('web', () => {
  it('renders the demo summary', () => {
    const html = renderToString(<SpendTab summary={DEMO_SUMMARY} />);
    expect(html).toContain('Where did my tokens go');
    expect(html).toContain('acme/api');
    expect(html).toContain('$412.37');
    expect(html).toContain('$750.00');
    expect(html).toContain('experimental-model-x');
    expect(html).toContain('<svg');
  });
  it('renders the empty state for null', () => {
    expect(renderToString(<SpendTab summary={null} />)).toContain('No spend data yet');
  });
  it('renders the marketing section', () => {
    const html = renderToString(<SpendSiteSection />);
    expect(html).toContain('npx fleet-spend');
    expect(html).toContain('$750');
    expect(html).toContain('9x');
    expect(html).toContain('acme/api');
  });
  it('burnTint thresholds', () => {
    expect([0, 1, 5, 10].map(burnTint)).toEqual(['idle', 'cool', 'warm', 'hot']);
  });
  it('demo is deterministic and unpriced-free of paths', () => {
    expect(JSON.stringify(DEMO_SUMMARY)).not.toMatch(/\/Users\//);
    expect(DEMO_SUMMARY.daily).toHaveLength(31);
  });
});
