// STUB: owned by task 12 (replace entirely).
import type { FleetView, Selection } from '../data/contract';

export interface FleetSceneProps {
  view: FleetView;
  selection: Selection;
  onSelect(sel: Selection): void;
}
export default function FleetScene(_props: FleetSceneProps) {
  return <div style={{ width: '100%', height: '100%' }} />;
}
