import { icons, type IconName } from '@fleet/ui';

/** Halyard icon (packages/ui/icons). Decorative unless a label is given. */
export function Icon({ name, label, size = 'sm' }: { name: IconName; label?: string; size?: 'sm' | 'md' }) {
  return (
    <span
      className={size === 'md' ? 'icon icon-md' : 'icon'}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: icons[name] }}
    />
  );
}
