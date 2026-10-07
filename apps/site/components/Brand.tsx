import { MARK_INNER, WORDMARK_INNER } from '@/lib/brand.generated';

export function Wordmark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 32"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: WORDMARK_INNER }}
    />
  );
}

export function Mark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      dangerouslySetInnerHTML={{ __html: MARK_INNER }}
    />
  );
}
