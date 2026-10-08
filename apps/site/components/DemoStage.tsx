'use client';
import { useState } from 'react';
import { FleetStage } from '@/components/FleetStage';

const NOTE: Record<string, string> = {
  reduced: 'Reduced motion is on, so this is a still render. Turn it off in your system settings to see the scene move.',
  'no-webgl': 'Your browser has WebGL turned off, so this is a still render of the same scene.',
  error: 'The 3D scene failed to load. This is a still render of it. Reload to try again.',
};

export function DemoStage() {
  const [why, setWhy] = useState<string>('pending');
  return (
    <>
      <FleetStage
        interactive
        posterAlt="Still render of the Fleet 3D view with a synthetic fleet"
        onState={setWhy}
      />
      {NOTE[why] && (
        <p className="demo-note" role="status">
          {NOTE[why]}
        </p>
      )}
    </>
  );
}
