import {NextRequest,NextResponse} from 'next/server';
import {isDemo} from '@/lib/runtime/config';
import {localStore} from '@/lib/storage';
import {getManagedTrip} from '@/lib/store';
import {demoSession} from '@/lib/demo/session';

export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  if(!isDemo())return new NextResponse(null,{status:404});
  try{
    // These are ordinary browser downloads, which cannot carry a custom header.
    // Authenticate the signed session and enforce ownership; no form is submitted.
    const session=await demoSession(request),{id}=await params;
    if(!session?.user?.actorId)return new NextResponse(null,{status:404});
    const actor={actorKey:session.user.actorId,kind:'account' as const};
    if(!/^[a-f0-9-]{36}$/.test(id))return new NextResponse(null,{status:404});
    const {db}=await localStore();
    const [row]=await db.query<{trip_id:string;message:{html:string;attachments:{content:string}[]}}>('SELECT trip_id,message FROM public.converge_preview_outbox WHERE id=$1::uuid',[id]);
    if(!row)return new NextResponse(null,{status:404});
    await getManagedTrip(row.trip_id,actor);
    const calendar=request.nextUrl.searchParams.get('format')==='ics';
    return new NextResponse(calendar?row.message.attachments[0].content:row.message.html,{headers:{'Content-Type':calendar?'text/calendar; charset=utf-8':'text/html; charset=utf-8','Content-Disposition':calendar?'attachment; filename="converge.ics"':'inline','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox"}});
  }catch{return new NextResponse(null,{status:404});}
}
