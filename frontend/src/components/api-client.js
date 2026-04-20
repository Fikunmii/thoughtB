/**
 * api-client.js
 * Shared API client for Thought Biography frontend.
 * All components import from here instead of writing raw fetch calls.
 *
 * Usage:
 *   import { api } from '../components/api-client'
 *   const data = await api.get('/dashboard')
 *   const result = await api.post('/entries', { content: '...' })
 */

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ── Token helpers (mirrors AuthStorage in Auth.jsx) ───────────────────────────
const getAccessToken  = () => sessionStorage.getItem('tb_access');
const getRefreshToken = () => localStorage.getItem('tb_refresh');
const saveTokens = (access, refresh) => {
  sessionStorage.setItem('tb_access', access);
  localStorage.setItem('tb_refresh', refresh);
};
const clearTokens = () => {
  sessionStorage.removeItem('tb_access');
  localStorage.removeItem('tb_refresh');
  localStorage.removeItem('tb_user');
};

// ── Token refresh ─────────────────────────────────────────────────────────────
async function refreshAccessToken() {
  const refresh = getRefreshToken();
  if (!refresh) return null;

  const res = await fetch(`${BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refresh }),
  });

  if (!res.ok) { clearTokens(); return null; }

  const data = await res.json();
  saveTokens(data.access_token, data.refresh_token);
  return data.access_token;
}

// ── Core fetch wrapper ────────────────────────────────────────────────────────
async function request(method, path, body = null, options = {}) {
  const url = `${BASE_URL}${path}`;

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const token = getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const config = {
    method,
    headers,
    signal: options.signal,
  };

  if (body && method !== 'GET') {
    config.body = JSON.stringify(body);
  }

  let res = await fetch(url, config);

  // Auto-refresh on 401
  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      res = await fetch(url, { ...config, headers });
    } else {
      // Refresh failed — redirect to login
      clearTokens();
      window.location.reload();
      return;
    }
  }

  // Return null for 204 No Content
  if (res.status === 204) return null;

  const data = await res.json();

  if (!res.ok) {
    const message = data?.detail || data?.message || `Request failed: ${res.status}`;
    throw new Error(message);
  }

  return data;
}

// ── Public API object ─────────────────────────────────────────────────────────
export const api = {
  get:    (path, options)       => request('GET',    path, null, options),
  post:   (path, body, options) => request('POST',   path, body, options),
  put:    (path, body, options) => request('PUT',    path, body, options),
  delete: (path, options)       => request('DELETE', path, null, options),
  patch:  (path, body, options) => request('PATCH',  path, body, options),
};

// ── File upload helper (for voice memos) ──────────────────────────────────────
export async function uploadFile(path, file, fieldName = 'file') {
  const formData = new FormData();
  formData.append(fieldName, file);

  const token = getAccessToken();
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.detail || `Upload failed: ${res.status}`);
  }

  return res.json();
}

// ── Server-Sent Events helper (for biography streaming) ───────────────────────
export function createEventStream(path, onChunk, onDone, onError) {
  const token = getAccessToken();
  const url   = `${BASE_URL}${path}${token ? `?token=${token}` : ''}`;

  const source = new EventSource(url);

  source.onmessage = (e) => {
    if (e.data === '[DONE]') {
      source.close();
      onDone?.();
    } else {
      onChunk?.(e.data);
    }
  };

  source.onerror = (e) => {
    source.close();
    onError?.(e);
  };

  // Return close function so caller can cancel
  return () => source.close();
}

// ── Health check ───────────────────────────────────────────────────────────────
export async function checkHealth() {
  try {
    const res = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Usage examples ─────────────────────────────────────────────────────────────
//
// In Dashboard.jsx:
//   import { api } from '../components/api-client'
//   const data = await api.get('/dashboard')
//
// In ThoughtBiography.jsx (ingest entry):
//   const result = await api.post('/entries', { content: text, source: 'journal' })
//
// In Search.jsx:
//   const results = await api.get(`/search?q=${query}&mode=${mode}`)
//
// In Export.jsx:
//   const file = await api.get(`/export?format=markdown`)
//
// In transcribe (voice memo upload):
//   import { uploadFile } from '../components/api-client'
//   const transcript = await uploadFile('/transcribe', audioBlob, 'audio')
//
// In BiographyDocument.jsx (streaming):
//   import { createEventStream } from '../components/api-client'
//   const close = createEventStream('/biography/generate',
//     chunk => setContent(c => c + chunk),
//     ()    => setDone(true),
//     err   => setError(err)
//   )
