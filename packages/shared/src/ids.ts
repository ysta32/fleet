import type { AgentRole } from './types.js';

export function projectIdFromPath(abs: string): string {
  return abs.replace(/[^a-zA-Z0-9]/g, '-');
}

export function projectNameFromPath(abs: string): string {
  return (
    abs
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? ''
  );
}

export function roleFromSubagentType(t?: string): AgentRole {
  switch (t) {
    case 'orch-coder':
      return 'coder';
    case 'orch-senior':
      return 'senior';
    case 'orch-critic':
      return 'critic';
    case 'orch-scout':
    case 'Explore':
      return 'scout';
    case 'orch-tester':
      return 'tester';
    case 'orch-triager':
      return 'triager';
    default:
      return 'other';
  }
}

let sequence = 0;

export function eventId(ts: number): string {
  return `${ts}-${sequence++}`;
}
