"use client";

/** Keep the server-rendered actor fixed for the life of this document. A cookie
 * change must not silently reassign an already-open form to a different account. */
export function identityFetch(url: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('X-Converge-Actor', document.body.dataset.actor || 'anonymous');
  return fetch(url, {...init, headers});
}
