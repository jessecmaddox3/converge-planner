import NextAuth from "next-auth";
import {NextRequest, NextResponse} from "next/server";
import {authOptions} from "@/lib/auth";
import {isDemo} from "@/lib/runtime/config";
import {demoSession} from "@/lib/demo/session";
const handler = NextAuth(authOptions);
export async function GET(request: NextRequest, context: any) {
  if (isDemo()) {
    if (request.nextUrl.pathname === '/api/auth/session') return NextResponse.json(await demoSession(request), {headers: {'Cache-Control': 'private, no-store'}});
    return NextResponse.json({error: 'Use the local demo persona selector.'}, {status: 404});
  }
  return handler(request, context);
}
export async function POST(request: NextRequest, context: any) {
  if (isDemo()) return NextResponse.json({error: 'Use the local demo persona selector.'}, {status: 404});
  return handler(request, context);
}
