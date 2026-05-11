import { auth } from './firebase';

/**
 * Drop-in replacement for `fetch` that attaches the current Firebase ID token
 * as a Bearer Authorization header.
 *
 * If the user isn't signed in, the request goes out without an Authorization
 * header — the caller's catch block will see whatever the backend returns
 * (typically 401), which keeps this helper composable with public endpoints.
 *
 * Usage:
 *   const res = await authedFetch(`${API_BASE_URL}/fields`);
 */
export async function authedFetch(input, init = {}) {
  let token = null;
  try {
    if (auth.currentUser) {
      token = await auth.currentUser.getIdToken();
    }
  } catch {
    // Token refresh can fail if the network drops; fall through unauthenticated.
  }

  const headers = new Headers(init.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(input, { ...init, headers });
}
