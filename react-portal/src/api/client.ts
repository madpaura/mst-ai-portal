const API_BASE = import.meta.env.VITE_API_URL || '';

// Token is now stored as an httpOnly cookie set by the backend on login.
// We keep a lightweight in-memory flag so the frontend can know whether
// the user is logged in without reading the cookie (which is inaccessible
// to JS by design). On page reload fetchUser() is the authoritative check.
let _loggedIn = false;

export function setToken(_token: string) {
  // Cookie is set by the server; nothing to store in JS.
  _loggedIn = true;
}

export function clearToken() {
  _loggedIn = false;
  // The cookie is cleared server-side via POST /auth/logout.
}

export function isLoggedIn(): boolean {
  return _loggedIn;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };

  // Don't set Content-Type for FormData (browser sets multipart boundary)
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',   // send httpOnly cookie on every request
  });

  if (!res.ok) {
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      throw new Error(`Server error (HTTP ${res.status}). Check API connectivity.`);
    }
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }

  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return {} as T;
  }

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    throw new Error('Server returned an unexpected response. Check API connectivity.');
  }

  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, file: File, fieldName = 'file') => {
    const formData = new FormData();
    formData.append(fieldName, file);
    return request<T>(path, { method: 'POST', body: formData });
  },
};
