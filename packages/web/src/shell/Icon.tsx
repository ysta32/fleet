import { icons, type IconName } from '@fleet/ui';

/** Halyard icon. Decorative unless `label` is given; size comes from CSS (--fl-icon-sm / --fl-icon-md). */
export function Icon({ name, label, className }: { name: IconName; label?: string; className?: string }) {
  return (
    <span
      className={`fl-icon${className ? ` ${className}` : ''}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: icons[name] }}
    />
  );
}

/** The Fleet mark: mast, signal pennant, orbit. Pennant and dot stay signal orange in both themes. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <ellipse
        cx="16"
        cy="18"
        rx="13"
        ry="5.25"
        transform="rotate(-14 16 18)"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.55"
      />
      <path d="M12 27V5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M12.75 4.75 25 9.25l-12.25 4.5z" fill="var(--fl-model-opus)" />
      <circle cx="27.6" cy="14.6" r="2" fill="var(--fl-model-opus)" />
    </svg>
  );
}

export function Kbd({ children }: { children: string }) {
  return <kbd className="fl-kbd">{children}</kbd>;
}
