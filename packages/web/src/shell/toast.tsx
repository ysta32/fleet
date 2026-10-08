import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';

export interface ToastInput {
  tone?: 'success' | 'info' | 'danger';
  message: string;
  /** Shown as a button; toasts with undo stay 5s and pause on hover. */
  undo?: () => void;
  /** Danger toasts persist until dismissed unless set. */
  persist?: boolean;
}
interface Toast extends ToastInput {
  id: number;
  leaving: boolean;
}
interface ToastApi {
  push(toast: ToastInput): number;
  dismiss(id: number): void;
  /** Runs the undo of the newest toast that still offers one (Z / Cmd Z). */
  undoLatest(): boolean;
}

const ToastContext = createContext<ToastApi>({ push: () => 0, dismiss: () => {}, undoLatest: () => false });
export const useToast = () => useContext(ToastContext);

const LIFETIME = 5000;

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss(id: number): void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(LIFETIME);
  useEffect(() => {
    if (paused || toast.leaving || toast.persist || toast.tone === 'danger') return;
    const started = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(800, remaining.current - (Date.now() - started));
    };
  }, [paused, toast, onDismiss]);
  const icon = toast.tone === 'danger' ? 'x' : toast.tone === 'info' ? 'live' : 'check';
  return (
    <li
      className={`toast tone-${toast.tone ?? 'success'}${toast.leaving ? ' leaving' : ''}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon name={icon} />
      <span className="toast-message">{toast.message}</span>
      {toast.undo && (
        <button
          type="button"
          className="toast-undo"
          onClick={() => {
            toast.undo?.();
            onDismiss(toast.id);
          }}
        >
          <Icon name="undo" />
          Undo
        </button>
      )}
      <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
        <Icon name="close" />
      </button>
    </li>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const toastsRef = useRef<Toast[]>([]);
  toastsRef.current = toasts;
  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)));
    window.setTimeout(() => setToasts((list) => list.filter((toast) => toast.id !== id)), 280);
  }, []);
  const push = useCallback((input: ToastInput) => {
    const id = next.current++;
    setToasts((list) => [...list.slice(-3), { ...input, id, leaving: false }]);
    return id;
  }, []);
  const undoLatest = useCallback(() => {
    const target = [...toastsRef.current].reverse().find((toast) => toast.undo && !toast.leaving);
    if (!target) return false;
    target.undo?.();
    dismiss(target.id);
    return true;
  }, [dismiss]);
  const api = useMemo(() => ({ push, dismiss, undoLatest }), [push, dismiss, undoLatest]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <ol className="toasts" aria-live="polite" aria-label="Notifications">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </ol>
    </ToastContext.Provider>
  );
}
