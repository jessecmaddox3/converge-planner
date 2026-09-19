'use client';
import {signIn as providerSignIn, signOut as providerSignOut} from 'next-auth/react';
export {useSession} from 'next-auth/react';

function demo() {return typeof document !== 'undefined' && document.body.dataset.mode === 'demo';}
async function choose(person: string) {
  const response = await fetch('/api/demo/identity', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({person})});
  if (!response.ok) throw new Error('Could not change the demo identity.');
  window.location.reload();
}
export async function signIn(...args: Parameters<typeof providerSignIn>) {
  if (demo()) {await choose('quinn'); return undefined;}
  return providerSignIn(...args);
}
export async function signOut(...args: Parameters<typeof providerSignOut>) {
  if (demo()) {await choose(''); return undefined;}
  return providerSignOut(...args);
}
