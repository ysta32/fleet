import type { IconName } from '@fleet/ui';

export interface PaletteItem {
  id: string;
  group: 'Commands' | 'Projects' | 'Sessions' | 'Agents';
  label: string;
  meta?: string;
  icon: IconName;
  shortcut?: string[];
  run(): void;
}

/** Subsequence fuzzy score: higher is better, -1 means no match. Word starts and runs score extra. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return 1000 - direct * 2 - (t.length - q.length) * 0.1;
  let score = 0;
  let from = 0;
  let run = 0;
  for (const char of q) {
    if (char === ' ') continue;
    const index = t.indexOf(char, from);
    if (index < 0) return -1;
    const boundary = index === 0 || /[\s\-_/.·]/.test(t[index - 1]);
    run = index === from ? run + 1 : 0;
    score += 10 + (boundary ? 15 : 0) + run * 5 - Math.min(10, index - from);
    from = index + 1;
  }
  return score;
}

const ORDER: PaletteItem['group'][] = ['Commands', 'Sessions', 'Projects', 'Agents'];

export function rankPalette(items: readonly PaletteItem[], query: string, limit = 40): PaletteItem[] {
  if (!query.trim())
    return items.filter((item) => item.group === 'Commands' || item.group === 'Projects').slice(0, limit);
  return items
    .map((item) => ({ item, score: fuzzyScore(query, `${item.label} ${item.meta ?? ''}`) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || ORDER.indexOf(a.item.group) - ORDER.indexOf(b.item.group))
    .slice(0, limit)
    .map((entry) => entry.item);
}
