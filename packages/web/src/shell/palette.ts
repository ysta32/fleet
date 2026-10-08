import type { IconName } from '@fleet/ui';

export interface PaletteItem {
  id: string;
  group: 'Recent' | 'Commands' | 'Projects' | 'Sessions' | 'Agents';
  label: string;
  meta?: string;
  icon: IconName;
  shortcut?: string[];
  /** last activity (ms) for entities; on phones the freshest sessions fill Recent when little was run */
  activeAt?: number;
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

export interface PaletteOptions {
  /** ids of recently run items, most recent first; shown as a Recent group when the query is empty */
  recent?: readonly string[];
  /**
   * phone or touch-first device: Recent leads (topped up with the most recently active sessions when
   * fewer than RECENT_LIMIT items were run), then entities (sessions, projects), then commands
   */
  touch?: boolean;
}

export const RECENT_LIMIT = 5;

/** Most-recent-first id list after running `id`, deduplicated and capped. */
export function pushRecent(recent: readonly string[], id: string, limit = RECENT_LIMIT): string[] {
  return [id, ...recent.filter((entry) => entry !== id)].slice(0, limit);
}

export function rankPalette(
  items: readonly PaletteItem[],
  query: string,
  limit = 40,
  options: PaletteOptions = {},
): PaletteItem[] {
  if (!query.trim()) {
    const byId = new Map(items.map((item) => [item.id, item]));
    const recent = (options.recent ?? [])
      .map((id) => byId.get(id))
      .filter((item): item is PaletteItem => item !== undefined)
      .slice(0, RECENT_LIMIT);
    if (options.touch && recent.length < RECENT_LIMIT) {
      const run = new Set(recent.map((item) => item.id));
      const fresh = items
        .filter((item) => item.group === 'Sessions' && item.activeAt !== undefined && !run.has(item.id))
        .sort((a, b) => (b.activeAt ?? 0) - (a.activeAt ?? 0))
        .slice(0, RECENT_LIMIT - recent.length);
      recent.push(...fresh);
    }
    const taken = new Set(recent.map((item) => item.id));
    const groups: PaletteItem['group'][] = options.touch
      ? ['Sessions', 'Projects', 'Commands']
      : ['Commands', 'Projects'];
    const rest = groups.flatMap((group) =>
      items.filter((item) => item.group === group && !taken.has(item.id)),
    );
    return [...recent.map((item) => ({ ...item, group: 'Recent' as const })), ...rest].slice(0, limit);
  }
  return items
    .map((item) => ({ item, score: fuzzyScore(query, `${item.label} ${item.meta ?? ''}`) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || ORDER.indexOf(a.item.group) - ORDER.indexOf(b.item.group))
    .slice(0, limit)
    .map((entry) => entry.item);
}
