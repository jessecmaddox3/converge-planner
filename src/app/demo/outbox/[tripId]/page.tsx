import {notFound} from 'next/navigation';
import {isDemo} from '@/lib/runtime/config';
import {localStore} from '@/lib/storage';
import {getAppSession} from '@/lib/runtime/session';
import {getManagedTrip} from '@/lib/store';
export const dynamic='force-dynamic';
export default async function OutboxPage({params}:{params:Promise<{tripId:string}>}){
  if(!isDemo())notFound();
  const {tripId}=await params,session=await getAppSession();
  if(!session?.user?.actorId)return <main className="demo-guide"><h1>Choose the trip organizer</h1><p>The preview outbox belongs to the organizer. Use the persona selector, then reload this page.</p></main>;
  let trip;try{trip=await getManagedTrip(tripId,{actorKey:session.user.actorId,kind:'account'});}catch{notFound();}
  const {db}=await localStore();
  const rows=await db.query<{id:string;created_at:string;confirmation_version:number;message:{to:string;subject:string;text:string;html:string}}>('SELECT id,created_at,confirmation_version,message FROM public.converge_preview_outbox WHERE trip_id=$1 ORDER BY created_at DESC',[tripId]);
  return <main className="demo-guide"><p className="eyebrow">Local preview, nothing emailed</p><h1>{trip.name}</h1><p><a href={'/manage/'+tripId}>Back to the trip</a>. Refresh this page after confirming a date. Older accepted previews remain visible after reopening; reopening cannot recall an already delivered message.</p>{rows.length?rows.map(row=><article className="preview-message" key={row.id}><h2>{row.message.subject}</h2><p>To {row.message.to}. Decision version {row.confirmation_version}.</p><p><a href={'/api/demo/outbox/'+row.id+'?format=html'} target="_blank" rel="noreferrer">Open rendered email</a> · <a href={'/api/demo/outbox/'+row.id+'?format=ics'}>Download calendar file</a></p><pre>{row.message.text}</pre></article>):<p>No previews yet. Confirm a date with respondents who supplied a fictional email address.</p>}</main>;
}
