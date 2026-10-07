/** 20px line icons, 1.5 stroke, currentColor. Decorative: always aria-hidden. */
const PATHS = {
  alert: 'M10 3.5 2.8 16a.6.6 0 0 0 .5.9h13.4a.6.6 0 0 0 .5-.9L10 3.5ZM10 8.5v3.5M10 14.5v.01',
  error: 'M10 2.75a7.25 7.25 0 1 0 0 14.5 7.25 7.25 0 0 0 0-14.5ZM7.5 7.5l5 5M12.5 7.5l-5 5',
  info: 'M10 2.75a7.25 7.25 0 1 0 0 14.5 7.25 7.25 0 0 0 0-14.5ZM10 9v4.5M10 6.5v.01',
  lock: 'M5.5 9h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1ZM7 9V6.5a3 3 0 0 1 6 0V9',
  folder: 'M2.75 5.5a1 1 0 0 1 1-1h3.6l1.6 1.75h7.3a1 1 0 0 1 1 1v8.25a1 1 0 0 1-1 1H3.75a1 1 0 0 1-1-1V5.5Z',
  key: 'M12.5 3.5a4 4 0 1 1-3.3 6.26L3.5 15.5v1h2v-1.5H7V13.5h1.5l.74-.74A4 4 0 0 1 12.5 3.5ZM13.5 6.5v.01',
  file: 'M5.5 2.75h6l3 3v11a.5.5 0 0 1-.5.5h-8.5a.5.5 0 0 1-.5-.5v-13.5a.5.5 0 0 1 .5-.5ZM11.5 2.75v3h3M7.5 10.5h5M7.5 13.5h5',
  check: 'M4.5 10.5l3.5 3.5 7.5-8',
  clock: 'M10 2.75a7.25 7.25 0 1 0 0 14.5 7.25 7.25 0 0 0 0-14.5ZM10 6v4l2.5 1.5',
  trend: 'M2.75 14.5 7.5 9.75l3 3 6.75-6.75M12.5 6h4.75v4.75',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, small }: { name: IconName; small?: boolean }) {
  return (
    <svg
      className={small ? 'fls-icon fls-icon-sm' : 'fls-icon'}
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
