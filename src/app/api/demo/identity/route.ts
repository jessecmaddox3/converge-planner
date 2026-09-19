import {NextRequest, NextResponse} from 'next/server';
import {isDemo, requireSameOrigin, runtimeConfig} from '@/lib/runtime/config';
import {DEMO_COOKIE, demoSession, issueDemoCookie} from '@/lib/demo/session';
import {demoPeople} from '@/lib/demo/people';

export async function GET(request: NextRequest) {
  if (!isDemo()) return new NextResponse(null, {status: 404});
  const session = await demoSession(request);
  return NextResponse.json({people: demoPeople, current: demoPeople.find(p => p.email === session?.user?.email)?.id || ''}, {headers: {'Cache-Control': 'private, no-store'}});
}
export async function POST(request: NextRequest) {
  if (!isDemo()) return new NextResponse(null, {status: 404});
  try {
    const config = runtimeConfig(); requireSameOrigin(request, config);
    if (Number(request.headers.get('content-length') || 0) > 256) throw new Error('Invalid persona');
    const raw = await request.text(); if (raw.length > 256) throw new Error('Invalid persona');
    const body = JSON.parse(raw);
    const value = body.person === '' ? '' : await issueDemoCookie(body.person);
    const response = NextResponse.json({ok: true}, {headers: {'Cache-Control': 'private, no-store'}});
    response.cookies.set(DEMO_COOKIE, value, {httpOnly: true, sameSite: 'strict', secure: config.origin.startsWith('https:'), path: '/', maxAge: value ? 7 * 86400 : 0});
    return response;
  } catch {return NextResponse.json({error: 'Choose a demo persona from this page.'}, {status: 400});}
}
