-- Additive: preserves all existing RPC signatures and legacy response semantics.
create or replace function public.validate_trip_response_answers()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
declare
  candidates jsonb;
  trip_data jsonb;
  selected jsonb;
begin
  select data into trip_data from public.trips where id = new.trip_id for update;
  candidates := trip_data->'selectedDates';
  if trip_data->'planning'->>'invitationsClosed' = 'true' then
    raise exception 'INVITATIONS_CLOSED' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and old.data->>'answerVersion' = '2' and new.data->>'answerVersion' is distinct from '2' then
    raise exception 'ANSWER_VERSION_REQUIRED' using errcode = 'P0001';
  end if;
  if new.data ? 'answers' or new.data ? 'answerVersion' then
    if new.data->'answerVersion' is distinct from '2'::jsonb or jsonb_typeof(new.data->'answers') is distinct from 'object'
      or jsonb_typeof(new.data->'selectedDates') is distinct from 'array'
      or jsonb_typeof(new.data->'preferences') is distinct from 'object' then
      raise exception 'INVALID_ANSWERS' using errcode = '23514';
    end if;
    if exists (select from jsonb_each_text(new.data->'answers') as answer(date, value)
      where not (candidates ? answer.date) or answer.value is null or answer.value not in ('available','maybe','unavailable')) then
      raise exception 'INVALID_ANSWERS' using errcode = '23514';
    end if;
    select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into selected from jsonb_each_text(new.data->'answers') where value = 'available';
    if selected is distinct from (select coalesce(jsonb_agg(value order by value), '[]'::jsonb) from jsonb_array_elements(new.data->'selectedDates')) then
      raise exception 'INVALID_ANSWER_PROJECTION' using errcode = '23514';
    end if;
    if exists (select from jsonb_each_text(new.data->'preferences') as preference(date, value)
      where not (selected ? preference.date) or preference.value not in ('available','preferred')) then
      raise exception 'INVALID_FAVORITE' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.validate_trip_response_answers() from public, anon, authenticated;
grant execute on function public.validate_trip_response_answers() to service_role;
drop trigger if exists validate_response_answers on public.trip_responses;
create trigger validate_response_answers before insert or update of data on public.trip_responses
for each row execute function public.validate_trip_response_answers();

-- Matches the stable public projection for embedded pre-capability responses.
-- This is only a reference check for organizer planning, never response ownership.
create or replace function public.trip_planning_response_exists(p_trip_id text, p_public_id text)
returns boolean language sql security invoker set search_path = pg_catalog as $$
  select exists(select from public.trip_responses r where r.trip_id = p_trip_id and r.public_id::text = p_public_id)
    or exists (
      select from public.trips t,
        jsonb_array_elements(case when jsonb_typeof(t.data->'responses') = 'array' then t.data->'responses' else '[]'::jsonb end) with ordinality as embedded(value, position)
      where t.id = p_trip_id and p_public_id = coalesce(nullif(embedded.value->>'publicId',''),
        'legacy-' || left(translate(encode(sha256(
          convert_to(p_trip_id,'UTF8') || decode('00','hex') || convert_to(coalesce(nullif(embedded.value->>'email',''),'') ,'UTF8') || decode('00','hex') ||
          convert_to(coalesce(nullif(embedded.value->>'name',''),'') ,'UTF8') || decode('00','hex') || convert_to((embedded.position - 1)::text,'UTF8')
        ),'base64'), '+/', '-_'),22))
    );
$$;
revoke all on function public.trip_planning_response_exists(text,text) from public, anon, authenticated;
grant execute on function public.trip_planning_response_exists(text,text) to service_role;

create or replace function public.update_trip_planning(p_trip_id text, p_actor_key text, p_planning jsonb)
returns table(result_code text) language plpgsql security invoker set search_path = pg_catalog as $$
declare
  active_trip public.trips%rowtype;
  revision integer;
begin
  select * into active_trip from public.trips where id = p_trip_id for update;
  if not found then return query select 'not_found'; return; end if;
  if p_actor_key is null or active_trip.organizer_actor_key is distinct from p_actor_key then return query select 'forbidden'; return; end if;
  if active_trip.status <> 'collecting' then return query select 'trip_confirmed'; return; end if;
  if jsonb_typeof(p_planning) is distinct from 'object'
    or jsonb_typeof(p_planning->'requiredResponseIds') is distinct from 'array'
    or jsonb_typeof(p_planning->'expectedPeople') is distinct from 'array'
    or jsonb_typeof(p_planning->'invitationsClosed') is distinct from 'boolean'
    or jsonb_typeof(p_planning->'revision') is distinct from 'number'
    or (p_planning->>'revision') !~ '^\d{1,9}$' then return query select 'invalid_argument'; return; end if;
  if jsonb_array_length(p_planning->'requiredResponseIds') > 100 or jsonb_array_length(p_planning->'expectedPeople') > 100 then return query select 'invalid_argument'; return; end if;
  revision := coalesce((active_trip.data->'planning'->>'revision')::integer, 0);
  if (p_planning->>'revision')::integer <> revision then return query select 'stale'; return; end if;
  if exists (
    select from jsonb_array_elements_text(p_planning->'requiredResponseIds') as required(id)
    where not public.trip_planning_response_exists(p_trip_id, required.id)
  ) or exists (
    select from jsonb_array_elements(p_planning->'expectedPeople') as person(value)
    where jsonb_typeof(value) is distinct from 'object'
      or jsonb_typeof(value->'id') is distinct from 'string'
      or jsonb_typeof(value->'name') is distinct from 'string'
      or char_length(btrim(value->>'name')) not between 1 and 100
      or jsonb_typeof(value->'required') is distinct from 'boolean'
      or (value ? 'responsePublicId' and not public.trip_planning_response_exists(p_trip_id, value->>'responsePublicId'))
  ) then return query select 'invalid_argument'; return; end if;
  if exists (select from jsonb_array_elements(p_planning->'expectedPeople') as person(value) group by value->>'id' having count(*) > 1)
    or exists (select from jsonb_array_elements(p_planning->'expectedPeople') as person(value) where value ? 'responsePublicId' group by value->>'responsePublicId' having count(*) > 1) then
    return query select 'invalid_argument'; return;
  end if;
  update public.trips set data = jsonb_set(data, '{planning}', jsonb_set(p_planning, '{revision}', to_jsonb(revision + 1))), updated_at = clock_timestamp() where id = p_trip_id;
  return query select 'updated';
end $$;
revoke all on function public.update_trip_planning(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.update_trip_planning(text, text, jsonb) to service_role;
