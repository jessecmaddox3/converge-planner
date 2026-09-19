-- Preserve the organizer's implicit availability and prevent double counting.
create or replace function public.reject_organizer_response()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
declare owner_key text;
begin
  select organizer_actor_key into owner_key from public.trips where id=new.trip_id for update;
  if owner_key is not null and owner_key=new.person_key then
    raise exception 'ORGANIZER_RESPONSE_FORBIDDEN' using errcode='P0001';
  end if;
  return new;
end $$;
revoke all on function public.reject_organizer_response() from public,anon,authenticated;
grant execute on function public.reject_organizer_response() to service_role;
drop trigger if exists reject_organizer_response on public.trip_responses;
create trigger reject_organizer_response before insert or update on public.trip_responses
for each row execute function public.reject_organizer_response();

-- Reopen means accepting availability again, including when collection was closed.
-- Update planning revision in the same locked transaction to invalidate stale forms.
create or replace function public.reopen_trip(p_trip_id text,p_actor_key text)
returns table(result_code text,confirmation_version integer)
language plpgsql security invoker set search_path = pg_catalog as $$
declare active public.trips%rowtype; planning jsonb; revision integer;
begin
  if p_trip_id is null or btrim(p_trip_id)='' or p_actor_key is null or btrim(p_actor_key)='' then
    return query select 'invalid_argument'::text,null::integer; return;
  end if;
  select * into active from public.trips where id=p_trip_id for update;
  if not found then return query select 'not_found'::text,null::integer; return; end if;
  if active.organizer_actor_key is distinct from p_actor_key then return query select 'forbidden'::text,active.confirmation_version; return; end if;
  planning:=coalesce(active.data->'planning','{"requiredResponseIds":[],"expectedPeople":[],"revision":0,"invitationsClosed":false}'::jsonb);
  if active.status='collecting' and planning->>'invitationsClosed' is distinct from 'true' then
    return query select 'already_collecting'::text,active.confirmation_version; return;
  end if;
  revision:=coalesce((planning->>'revision')::integer,0);
  planning:=planning||jsonb_build_object('invitationsClosed',false,'revision',revision+1);
  update public.trips set status='collecting',confirmed_date=null,confirmed_at=null,updated_at=clock_timestamp(),
    data=jsonb_set(jsonb_set(active.data,'{confirmedDate}','null'::jsonb),'{planning}',planning)
  where id=p_trip_id;
  return query select 'reopened'::text,active.confirmation_version;
end $$;
revoke all on function public.reopen_trip(text,text) from public,anon,authenticated;
grant execute on function public.reopen_trip(text,text) to service_role;
