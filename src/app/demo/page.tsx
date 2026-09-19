import {notFound} from 'next/navigation';
import {isDemo} from '@/lib/runtime/config';
import {localStore} from '@/lib/storage';
import {getAppSession} from '@/lib/runtime/session';
import {listTripsForActor} from '@/lib/store';
export const dynamic='force-dynamic';
export default async function DemoPage(){
  if(!isDemo())notFound();
  const {db}=await localStore();
  const [seed]=await db.query<{seed_data:{orchard:string;observatory:string}}>('SELECT seed_data FROM public.converge_instance WHERE id=1');
  const session=await getAppSession();
  const owned=session?.user?.actorId?(await listTripsForActor({actorKey:session.user.actorId,kind:'account'})).filter(t=>t.role==='organizer'):[];
  return <main className="demo-guide"><p className="eyebrow">Local demo</p><h1>Make a plan together.</h1><p>Try the whole journey with invented people. Use the selector above to become an organizer or invitee. Your edits stay on this computer after a restart.</p><ol><li>Choose <strong>Quinn Vale</strong>, then <a href={'/manage/'+seed.seed_data.orchard}>manage the Orchard sketching weekend</a>. Compare its three weekends and private expected-person roster.</li><li>Choose <strong>Reed</strong> or <strong>Morgan</strong>, then <a href={'/join/'+seed.seed_data.orchard}>answer as an invitee</a>. Change an answer or privately check the fictional calendar.</li><li>Return to Quinn, confirm a date, and open the preview outbox below. Reopen to collect new answers. No emails are sent.</li><li><a href="/">Create your own trip</a> to explore calendars and build a shortlist. “Connect calendar” uses invented events here.</li></ol><h2>Your preview outboxes</h2><p>Only the current trip organizer can open a preview. A preview shows what a configured hosted installation would email, including its downloadable calendar file.</p>{owned.length?<ul>{owned.map(t=><li key={t.id}><a href={'/demo/outbox/'+t.id}>{t.name}</a></li>)}</ul>:<p>Choose Quinn or Taylor to see their trips.</p>}<p><a href={'/manage/'+seed.seed_data.observatory}>Taylor’s separate observatory plan</a> demonstrates another organizer’s private management area.</p></main>;
}
