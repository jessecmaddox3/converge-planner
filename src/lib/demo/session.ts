import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Session } from 'next-auth';
import { accountActor } from '../actor';
import { isDemo } from '../runtime/config';
import { localStore } from '../storage';
import { demoPeople } from './people';

export const DEMO_COOKIE = 'converge_demo_session';
type Claims = {person: string; instance: string; expires: number};
function sign(value: string, secret: string) {return createHmac('sha256', secret).update(value).digest('base64url');}

export async function issueDemoCookie(person: string): Promise<string> {
  if (!isDemo() || !demoPeople.some(p => p.id === person)) throw new Error('Invalid demo persona');
  const {marker} = await localStore();
  const body = Buffer.from(JSON.stringify({person, instance: marker.instanceId, expires: Date.now() + 7 * 86400000} satisfies Claims)).toString('base64url');
  return body + '.' + sign(body, marker.sessionSecret);
}

export async function demoSession(request?: Request): Promise<Session | null> {
  if (!isDemo()) return null;
  let raw: string | undefined;
  if (request) raw = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(DEMO_COOKIE + '='))?.slice(DEMO_COOKIE.length + 1);
  else {const {cookies} = await import('next/headers'); raw = (await cookies()).get(DEMO_COOKIE)?.value;}
  if (!raw || raw.length > 1024) return null;
  const parts = raw.split('.'); if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0])) return null;
  const {marker} = await localStore();
  const wanted = Buffer.from(sign(parts[0], marker.sessionSecret)), supplied = Buffer.from(parts[1]);
  if (wanted.length !== supplied.length || !timingSafeEqual(wanted, supplied)) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as Claims;
    const person = demoPeople.find(p => p.id === claims.person);
    if (!person || claims.instance !== marker.instanceId || !Number.isFinite(claims.expires) || claims.expires <= Date.now()) return null;
    return {user: {name: person.name, email: person.email, actorId: accountActor('demo:' + person.id, marker.actorSecret)}, expires: new Date(claims.expires).toISOString()};
  } catch {return null;}
}
