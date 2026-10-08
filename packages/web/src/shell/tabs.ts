import type { IconName } from '@fleet/ui';
import type { DashboardTab } from '../dashboard/Dashboard';

export const TABS: { id: DashboardTab; label: string; icon: IconName; key: string }[] = [
  { id: 'overview', label: 'Overview', icon: 'fleet', key: 'o' },
  { id: 'sessions', label: 'Sessions', icon: 'session', key: 's' },
  { id: 'armies', label: 'Armies', icon: 'army', key: 'a' },
  { id: 'prs', label: 'PRs', icon: 'merge', key: 'p' },
  { id: 'alerts', label: 'Alerts', icon: 'bell', key: 'i' },
  { id: 'overnight', label: 'Overnight', icon: 'moon', key: 'n' },
  { id: 'spend', label: 'Spend', icon: 'cost', key: 'c' },
];
