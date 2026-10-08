// Apply the saved theme before first paint so there is no flash (external file: the collector CSP forbids inline scripts).
try {
  var saved = localStorage.getItem('fleet.theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
} catch (e) {}
