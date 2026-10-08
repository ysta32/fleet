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

describe('rankPalette phone recents', () => {
  const active = (id: string, at: number): PaletteItem => ({ ...item(id, 'Sessions'), activeAt: at });
  const fleet: PaletteItem[] = [
    item('tab:overview', 'Commands', 'Go to overview'),
    active('session:old', 100),
    active('session:new', 300),
    active('session:mid', 200),
    item('project:a', 'Projects', 'aurora-api'),
  ];
  it('leads with Recent, topped up by the freshest sessions, before any command', () => {
    const ranked = rankPalette(fleet, '', 40, { touch: true, recent: ['project:a'] });
    expect(ranked.map((entry) => `${entry.group}:${entry.id}`)).toEqual([
      'Recent:project:a',
      'Recent:session:new',
      'Recent:session:mid',
      'Recent:session:old',
      'Commands:tab:overview',
    ]);
  });
  it('keeps pointer devices on their stored recents only', () => {
    const ranked = rankPalette(fleet, '', 40, { recent: ['project:a'] });
    expect(ranked[0]).toMatchObject({ id: 'project:a', group: 'Recent' });
    expect(ranked[1].group).toBe('Commands');
  });
  it('caps the Recent group at RECENT_LIMIT', () => {
    const many = Array.from({ length: 9 }, (_, i) => active(`session:${i}`, i));
    const ranked = rankPalette(many, '', 40, { touch: true });
    expect(ranked.filter((entry) => entry.group === 'Recent').map((entry) => entry.id)).toEqual([
      'session:8',
      'session:7',
      'session:6',
      'session:5',
      'session:4',
    ]);
  });
});
