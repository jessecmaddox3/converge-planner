import {accountActor} from '../actor';
import {localStore} from '../storage';
import {createTrip, submitAvailability, updateTripPlanning, type Actor} from '../store';
import {demoPeople} from './people';

export async function seedDemo() {
  const {db,marker} = await localStore();
  const [row] = await db.query<{seed_version: number}>('SELECT seed_version FROM public.converge_instance WHERE id=1');
  if (row.seed_version === 1) return;
  if (row.seed_version !== 0) throw new Error('Unrecognized demo seed version; existing records will not be replaced.');
  const actors: Actor[] = demoPeople.map(p => ({actorKey: accountActor('demo:' + p.id,marker.actorSecret),kind:'account',name:p.name,email:p.email}));
  await db.execute('BEGIN');
  try {
    const id = await createTrip({name:'Orchard sketching weekend',startDate:'2030-05-01',endDate:'2030-05-31',duration:3,durationPreset:'weekend',notes:'An invented trip for sketching, walking, and sharing a picnic. Pick the weekend that fits the group.',selectedDates:['2030-05-03','2030-05-10','2030-05-17'],timeZone:'Europe/London'},actors[0]);
    const reed = await submitAvailability(id,actors[1],{name:actors[1].name!,selectedDates:['2030-05-03','2030-05-17'],preferences:{'2030-05-17':'preferred'},conflictCount:0,answerVersion:2,answers:{'2030-05-03':'available','2030-05-10':'unavailable','2030-05-17':'available'}});
    const morgan = await submitAvailability(id,actors[2],{name:actors[2].name!,selectedDates:['2030-05-10','2030-05-17'],preferences:{},conflictCount:0,answerVersion:2,answers:{'2030-05-03':'maybe','2030-05-10':'available','2030-05-17':'available'}});
    await updateTripPlanning(id,actors[0],{revision:0,invitationsClosed:false,requiredResponseIds:[reed.publicId],expectedPeople:[{id:'expected-reed',name:actors[1].name,required:true,responsePublicId:reed.publicId},{id:'expected-morgan',name:actors[2].name,required:false,responsePublicId:morgan.publicId},{id:'expected-avery',name:'Avery Brook',required:false}]});
    const second = await createTrip({name:'Observatory evening',startDate:'2030-06-01',endDate:'2030-06-30',duration:1,durationPreset:'day',notes:'A second fictional organizer demonstrates separate ownership.',selectedDates:['2030-06-08','2030-06-15'],timeZone:'Europe/London'},actors[3]);
    await db.query('UPDATE public.converge_instance SET seed_version=1,seed_data=$1::jsonb WHERE id=1',[JSON.stringify({orchard:id,observatory:second})]);
    await db.execute('COMMIT');
  } catch (error) {await db.execute('ROLLBACK');throw error;}
}
