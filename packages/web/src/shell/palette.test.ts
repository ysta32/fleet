import { describe, expect, it } from 'vitest';
import { pushRecent, rankPalette, type PaletteItem } from './palette';

const item = (id: string, group: PaletteItem['group'], label = id): PaletteItem => ({
  id,
  group,
  label,
  icon: 'session',
  run: () => {},
});
const items: PaletteItem[] = [
  item('tab:overview', 'Commands', 'Go to overview'),
  item('push', 'Commands', 'Phone alerts'),
  item('project:a', 'Projects', 'aurora-api'),
  item('session:1', 'Sessions', 'Synthetic build'),
  item('agent:1', 'Agents', 'lead'),
];

describe('rankPalette empty state', () => {
  it('lists commands then projects on pointer devices', () => {
    expect(rankPalette(items, '').map((entry) => entry.id)).toEqual(['tab:overview', 'push', 'project:a']);
  });
  it('puts sessions and projects ahead of commands on touch', () => {
    expect(rankPalette(items, '', 40, { touch: true }).map((entry) => entry.id)).toEqual([
      'session:1',
      'project:a',
      'tab:overview',
      'push',
    ]);
  });
  it('leads with recents, once each, skipping ids that no longer exist', () => {
    const ranked = rankPalette(items, '', 40, { recent: ['session:1', 'gone', 'push'] });
    expect(ranked.map((entry) => [entry.id, entry.group])).toEqual([
      ['session:1', 'Recent'],
      ['push', 'Recent'],
      ['tab:overview', 'Commands'],
      ['project:a', 'Projects'],
    ]);
  });
  it('ignores recents once the operator types', () => {
    const ranked = rankPalette(items, 'phone', 40, { recent: ['session:1'] });
    expect(ranked[0]).toMatchObject({ id: 'push', group: 'Commands' });
  });
});

describe('pushRecent', () => {
  it('moves the id to the front, dedupes and caps the list', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(pushRecent(['a', 'b', 'c', 'd', 'e'], 'f')).toEqual(['f', 'a', 'b', 'c', 'd']);
  });
});
