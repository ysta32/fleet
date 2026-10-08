import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Halyard faces, self-hosted (the collector CSP is default-src 'self' and transcripts-adjacent UIs
// should not call out to a font CDN). Same families as @fleet/ui/fonts.css.
import '@fontsource/schibsted-grotesk/latin-400.css';
import '@fontsource/schibsted-grotesk/latin-500.css';
import '@fontsource/schibsted-grotesk/latin-600.css';
import '@fontsource/schibsted-grotesk/latin-700.css';
import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fleet/ui/tokens.css';
import { App } from './App';
import { registerServiceWorker } from './pwa';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
registerServiceWorker();
