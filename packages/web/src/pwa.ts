/** Registers the app-shell service worker (production builds only; never in dev or demo screenshots). */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  if (!window.isSecureContext && window.location.hostname !== 'localhost') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error: unknown) => {
      console.warn('[fleet] service worker not registered', error);
    });
  });
}
