import { getServerSession } from 'next-auth';
import { authOptions } from '../auth';
import { isDemo } from './config';
import { demoSession } from '../demo/session';
import { ApiError } from '../http';

/** The header asserts what the page displayed; only the signed session grants authority. */
export async function getAppSession(request?: Request) {
  const session = await (isDemo() ? demoSession(request) : getServerSession(authOptions));
  if (request && request.headers.get('X-Converge-Actor') !== (session?.user?.actorId || 'anonymous')) {
    throw new ApiError(409, 'SESSION_CHANGED', 'The account changed in another tab. Reload this page before continuing.');
  }
  return session;
}
