/* Fleet service-worker policy: pure functions shared by sw.js (via importScripts) and unit tests.
 * Rules: never touch /api or any URL carrying a token; only HTML navigations may replace the cached shell. */
(function (root) {
  function isApi(pathname) {
    return pathname === '/api' || pathname.startsWith('/api/');
  }
  /** Should the worker intercept this request at all? */
  function shouldHandle(method, url, origin) {
    if (method !== 'GET') return false;
    if (url.origin !== origin) return false;
    if (isApi(url.pathname)) return false;
    if (url.searchParams.has('token')) return false;
    return true;
  }
  /** Only a successful HTML document from a navigation may become the cached app shell. */
  function isShellNavigation(mode, status, contentType) {
    return mode === 'navigate' && status === 200 && /^text\/html\b/i.test(contentType || '');
  }
  /** Same-origin, immutable or shell static files that are safe to cache. */
  function isCacheableAsset(pathname, shell) {
    if (isApi(pathname)) return false;
    return pathname.startsWith('/assets/') || pathname.startsWith('/icons/') || shell.indexOf(pathname) >= 0;
  }
  /** Extract built asset paths (scripts, styles, preloads) referenced by index.html. */
  function shellAssets(html) {
    var out = [];
    var re = /(?:src|href)="(\/[^"?#]+)"/g;
    var match;
    while ((match = re.exec(html))) {
      var path = match[1];
      if (!isApi(path) && out.indexOf(path) < 0 && path.startsWith('/assets/')) out.push(path);
    }
    return out;
  }
  root.fleetSwPolicy = {
    isApi: isApi,
    shouldHandle: shouldHandle,
    isShellNavigation: isShellNavigation,
    isCacheableAsset: isCacheableAsset,
    shellAssets: shellAssets,
  };
})(typeof self !== 'undefined' ? self : globalThis);
