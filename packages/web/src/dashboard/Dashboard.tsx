// STUB: owned by task 13 (replace entirely).
import type { FleetView, Selection } from '../data/contract';

export type DashboardTab = 'overview' | 'sessions' | 'armies' | 'prs' | 'alerts' | 'overnight';
export interface DashboardProps {
  view: FleetView;
  selection: Selection;
  onSelect(sel: Selection): void;
  tab: DashboardTab;
}
export default function Dashboard(_props: DashboardProps) {
  return <div />;
}
