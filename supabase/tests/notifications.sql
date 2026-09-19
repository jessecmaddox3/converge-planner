begin;
set local role service_role;
insert into public.trips (id, data, organizer_actor_key) values ('notifications-test', '{"selectedDates":["2026-10-09"]}', 'account:notification-test');
insert into public.trip_responses(trip_id,person_key,public_id,data) values ('notifications-test','capability:notification-test','44444444-4444-4444-8444-444444444444','{"name":"Test","email":"test@example.com","selectedDates":["2026-10-09"]}');
select * from public.confirm_trip_once('notifications-test','account:notification-test','2026-10-09');
do $$ declare first_claim record; second_claim record; rows integer;
begin
  select * into first_claim from public.claim_notification_batch('notifications-test',3);
  if first_claim.lease_token is null then raise exception 'no claim'; end if;
  select count(*) into rows from public.claim_notification_batch('notifications-test',3);
  if rows <> 0 then raise exception 'double claim'; end if;
  if not public.notification_claim_is_current(first_claim.trip_id,1,first_claim.response_public_id,first_claim.lease_token) then raise exception 'invalid fresh claim'; end if;
  -- Old application completions cannot steal a new worker lease.
  perform public.complete_confirmation_delivery('notifications-test','account:notification-test',1,first_claim.response_public_id,true);
  if not public.notification_claim_is_current(first_claim.trip_id,1,first_claim.response_public_id,first_claim.lease_token) then raise exception 'old completion stole lease'; end if;
  update public.trip_confirmation_deliveries set lease_expires_at = clock_timestamp() - interval '1 second' where trip_id = 'notifications-test';
  select * into second_claim from public.claim_notification_batch('notifications-test',3);
  if second_claim.lease_token = first_claim.lease_token or second_claim.lease_token is null then raise exception 'lease was not renewed'; end if;
  if public.finish_notification(first_claim.trip_id,1,first_claim.response_public_id,first_claim.lease_token,true) then raise exception 'stale completion accepted'; end if;
  if not public.finish_notification(second_claim.trip_id,1,second_claim.response_public_id,second_claim.lease_token,false) then raise exception 'failure not recorded'; end if;
  select count(*) into rows from public.claim_notification_batch('notifications-test',3);
  if rows <> 0 then raise exception 'backoff ignored'; end if;
  update public.trip_confirmation_deliveries set next_attempt_at = clock_timestamp() - interval '1 second' where trip_id = 'notifications-test';
  select * into second_claim from public.claim_notification_batch('notifications-test',3);
  perform public.reopen_trip('notifications-test','account:notification-test');
  if public.notification_claim_is_current(second_claim.trip_id,1,second_claim.response_public_id,second_claim.lease_token) then raise exception 'reopened still current'; end if;
  if public.finish_notification(second_claim.trip_id,1,second_claim.response_public_id,second_claim.lease_token,true) then raise exception 'reopened completion accepted'; end if;
  if has_function_privilege('anon','public.claim_notification_batch(text,integer)','EXECUTE') or has_function_privilege('authenticated','public.cleanup_converge_storage()','EXECUTE') then raise exception 'public worker access'; end if;
end $$;
insert into public.cached_jobs(key,value,expires_at) values ('expired-maintenance-test','{}',now() - interval '1 second');
insert into public.cached_jobs(key,updated_at) values ('failed-maintenance-test',now() - interval '1 day');
select public.cleanup_converge_storage();
do $$ begin
  if exists(select from public.cached_jobs where key in ('expired-maintenance-test','failed-maintenance-test')) then raise exception 'private cache not purged'; end if;
end $$;
rollback;
