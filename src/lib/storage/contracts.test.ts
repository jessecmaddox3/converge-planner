import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { embeddedDatabase, migrate, type Database } from './database';
import { sqlStorage, type Storage } from './port';

let db: Database, storage: Storage;
beforeAll(async () => {db = await embeddedDatabase(); await migrate(db); storage = sqlStorage(async () => db);}, 30000);
afterAll(async () => {if (db) await db.close();});

describe('same SQL lifecycle in the local demo', () => {
  it('retains JSON objects and canonical date/timestamp values', async () => {
    expect((await storage.insertTrip({id: 'fictional-orchard', data: {name: 'Orchard sketches', selectedDates: ['2037-05-14'], planning: {revision: 0, invitationsClosed: false, requiredResponseIds: [], expectedPeople: []}}, status: 'collecting', organizer_actor_key: 'account:quinn', organizer_email_normalized: 'quinn@example.org', confirmed_date: null, confirmed_at: null, confirmation_version: 0, updated_at: '2037-01-01T12:00:00Z'})).error).toBeNull();
    const row = (await storage.tripRow('fictional-orchard')).data!;
    expect(row.data).toMatchObject({name: 'Orchard sketches'});
    expect(typeof row.created_at).toBe('string');
  });
  it('rejects an organizer self-response at the SQL mutation boundary', async () => {
    const result = await storage.rpc('submit_trip_response', {p_trip_id: 'fictional-orchard', p_actor_key: 'account:quinn', p_data: {name: 'Quinn', selectedDates: [], preferences: {}, conflictCount: 0}});
    expect(result.error?.message).toBe('ORGANIZER_RESPONSE_FORBIDDEN');
  });
  it('close -> confirm -> reopen atomically clears closure and invalidates stale planning', async () => {
    const planning = {revision: 0, invitationsClosed: true, requiredResponseIds: [], expectedPeople: []};
    expect((await storage.rpc('update_trip_planning', {p_trip_id: 'fictional-orchard', p_actor_key: 'account:quinn', p_planning: planning})).data?.[0].result_code).toBe('updated');
    expect((await storage.rpc('confirm_trip_once', {p_trip_id: 'fictional-orchard', p_actor_key: 'account:quinn', p_date: '2037-05-14'})).data?.[0].result_code).toBe('confirmed');
    expect((await storage.rpc('reopen_trip', {p_trip_id: 'fictional-orchard', p_actor_key: 'account:quinn'})).data?.[0].result_code).toBe('reopened');
    const row = (await storage.tripRow('fictional-orchard')).data!;
    expect(row.status).toBe('collecting');
    expect(row.data).toMatchObject({planning: {invitationsClosed: false, revision: 2}});
    const answer = await storage.rpc('submit_trip_response', {p_trip_id: 'fictional-orchard', p_actor_key: 'capability:reed', p_data: {name: 'Reed', email: 'reed@example.org', selectedDates: ['2037-05-14'], preferences: {}, conflictCount: 0}});
    expect(answer.error).toBeNull(); expect(answer.data?.[0].result_code).toBe('created');
    expect((await storage.rpc('update_trip_planning', {p_trip_id: 'fictional-orchard', p_actor_key: 'account:quinn', p_planning: {...planning, revision: 1}})).data?.[0].result_code).toBe('stale');
  });
  it('never lets browser roles read private tables or call the service lifecycle', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.execute('SET ROLE ' + role);
      await expect(db.query('SELECT * FROM public.trips')).rejects.toThrow(/permission denied/);
      await expect(db.query("SELECT * FROM public.reopen_trip('fictional-orchard','account:quinn')")).rejects.toThrow(/permission denied/);
      await db.execute('RESET ROLE');
    }
  });
});
