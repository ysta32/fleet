import { describe, expect, it } from 'vitest';
import { eventId, projectIdFromPath, projectNameFromPath, roleFromSubagentType } from './index.js';

describe('project paths', () => {
  it.each([
    ['/Users/synthetic/dev/fleet', '-Users-synthetic-dev-fleet', 'fleet'],
    ['/tmp/a_b.c d/', '-tmp-a-b-c-d-', 'a_b.c d'],
    ['/tmp/a//b', '-tmp-a--b', 'b'],
    ['/tmp/café', '-tmp-caf-', 'café'],
    ['', '', ''],
    ['/', '-', ''],
  ])('encodes %s without collapsing punctuation', (path, id, name) => {
    expect(projectIdFromPath(path)).toBe(id);
    expect(projectNameFromPath(path)).toBe(name);
  });
});

describe('roleFromSubagentType', () => {
  it.each([
    ['orch-coder', 'coder'],
    ['orch-senior', 'senior'],
    ['orch-critic', 'critic'],
    ['orch-scout', 'scout'],
    ['Explore', 'scout'],
    ['orch-tester', 'tester'],
    ['orch-triager', 'triager'],
    ['general-purpose', 'other'],
    ['toString', 'other'],
    ['', 'other'],
    [undefined, 'other'],
  ])('maps %s to %s', (type, role) => {
    expect(roleFromSubagentType(type)).toBe(role);
  });
});

describe('eventId', () => {
  it('includes the timestamp and unique increasing sequence across repeated timestamps', () => {
    const ids = [eventId(1000), eventId(1000), eventId(1001), eventId(1000)];
    expect(new Set(ids).size).toBe(4);
    expect(ids[0]).toMatch(/^1000-\d+$/);
    expect(ids[2]).toMatch(/^1001-\d+$/);
    const sequences = ids.map((id) => Number(id.split('-')[1]));
    expect(sequences.slice(1)).toEqual(sequences.slice(0, -1).map((value) => value + 1));
  });
});
