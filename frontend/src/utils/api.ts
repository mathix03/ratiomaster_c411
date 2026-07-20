export const API_URL = import.meta.env.DEV ? 'http://localhost:3001/api' : `${window.location.origin}/api`;

export const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
  const token = localStorage.getItem('token');
  const headers = new Headers(options.headers || {});
  
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  
  const response = await fetch(`${API_URL}${url}`, {
    ...options,
    headers
  });
  
  // If unauthorized, token is invalid or expired
  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem('token');
    // We don't want to redirect forcefully if we are already on login page
    if (window.location.pathname !== '/login') {
        window.location.href = '/login';
    }
  }

  return response;
};

/**
 * Subscribe to the admin real-time feed (Server-Sent Events).
 *
 * Uses fetch + ReadableStream (not the native EventSource) so the JWT can travel
 * in the Authorization header like every other request, instead of leaking into
 * the URL. Automatically reconnects with backoff after network drops.
 *
 * Returns an unsubscribe function; call it on unmount.
 */
export function subscribeAdminStream(
  onData: (snapshot: any) => void,
  onStatus?: (connected: boolean) => void
): () => void {
  const controller = new AbortController();
  let closed = false;
  let retryDelay = 1000;

  const run = async () => {
    while (!closed) {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/admin/stream`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        });

        if (res.status === 401 || res.status === 403) {
          // Token invalid/expired — mirror fetchWithAuth and bounce to login.
          localStorage.removeItem('token');
          if (window.location.pathname !== '/login') window.location.href = '/login';
          return;
        }
        if (!res.ok || !res.body) throw new Error(`stream failed: ${res.status}`);

        onStatus?.(true);
        retryDelay = 1000; // reset backoff on a healthy connection

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!closed) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line
          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const dataStr = frame
              .split('\n')
              .filter(line => line.startsWith('data:'))
              .map(line => line.slice(5).replace(/^ /, ''))
              .join('\n');
            if (dataStr) {
              try { onData(JSON.parse(dataStr)); } catch { /* ignore malformed frame */ }
            }
          }
        }
      } catch {
        if (closed) return; // aborted on unmount, not a real error
      }

      onStatus?.(false);
      if (closed) return;
      await new Promise(r => setTimeout(r, retryDelay));
      retryDelay = Math.min(retryDelay * 2, 15000);
    }
  };

  run();

  return () => {
    closed = true;
    controller.abort();
  };
}
