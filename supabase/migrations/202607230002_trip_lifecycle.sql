create table if not exists public.trips (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.trip_responses (
  trip_id text not null
    references public.trips (id)
    on delete cascade,
  person_key text not null,
  data jsonb not null,
  submitted_at timestamptz not null default now(),
  primary key (trip_id, person_key)
);

alter table public.trips
  add column if not exists status text,
  add column if not exists organizer_actor_key text,
  add column if not exists organizer_email_normalized text,
  add column if not exists confirmed_date date,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmation_version integer,
  add column if not exists updated_at timestamptz;

update public.trips
set organizer_email_normalized = lower(nullif(btrim(data->>'organizerEmail'), ''))
where organizer_email_normalized is null;

do $backfill_confirmed_dates$
declare
  candidate record;
begin
  for candidate in
    select id, data->>'confirmedDate' as confirmed_date_text
    from public.trips
    where
      confirmed_date is null and
      data->>'confirmedDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  loop
    begin
      update public.trips
      set confirmed_date = candidate.confirmed_date_text::date
      where id = candidate.id;
    exception
      when datetime_field_overflow or invalid_datetime_format then
        null;
    end;
  end loop;
end;
$backfill_confirmed_dates$;

update public.trips
set
  status = case when confirmed_date is null then 'collecting' else 'confirmed' end,
  confirmation_version = case when confirmed_date is null then 0 else 1 end,
  confirmed_at = case
    when confirmed_date is not null then coalesce(confirmed_at, created_at, now())
    else null
  end,
  updated_at = coalesce(updated_at, created_at, now())
where
  status is null or
  confirmation_version is null or
  updated_at is null or
  (confirmed_date is not null and confirmed_at is null);

alter table public.trips
  alter column status set default 'collecting',
  alter column status set not null,
  alter column confirmation_version set default 0,
  alter column confirmation_version set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $trip_constraints$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.trips'::regclass and conname = 'trips_status_check'
  ) then
    alter table public.trips
      add constraint trips_status_check
      check (status in ('collecting', 'confirmed'));
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.trips'::regclass and conname = 'trips_confirmation_version_check'
  ) then
    alter table public.trips
      add constraint trips_confirmation_version_check
      check (confirmation_version >= 0);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.trips'::regclass and conname = 'trips_lifecycle_consistency_check'
  ) then
    alter table public.trips
      add constraint trips_lifecycle_consistency_check
      check (
        (
          status = 'collecting' and
          confirmed_date is null and
          confirmed_at is null
        ) or (
          status = 'confirmed' and
          confirmed_date is not null and
          confirmed_at is not null
        )
      );
  end if;
end;
$trip_constraints$;

create index if not exists trips_organizer_actor_key_idx
  on public.trips (organizer_actor_key)
  where organizer_actor_key is not null;

alter table public.trip_responses
  add column if not exists public_id uuid,
  add column if not exists updated_at timestamptz;

update public.trip_responses
set
  public_id = coalesce(public_id, gen_random_uuid()),
  updated_at = coalesce(updated_at, submitted_at, now())
where public_id is null or updated_at is null;

alter table public.trip_responses
  alter column public_id set default gen_random_uuid(),
  alter column public_id set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

create unique index if not exists trip_responses_public_id_key
  on public.trip_responses (public_id);

create unique index if not exists trip_responses_trip_public_id_key
  on public.trip_responses (trip_id, public_id);

create table if not exists public.trip_confirmation_deliveries (
  trip_id text not null,
  confirmation_version integer not null,
  response_public_id uuid not null,
  to_email text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, confirmation_version, response_public_id),
  constraint trip_confirmation_deliveries_trip_fk
    foreign key (trip_id)
    references public.trips (id)
    on delete cascade,
  constraint trip_confirmation_deliveries_response_fk
    foreign key (trip_id, response_public_id)
    references public.trip_responses (trip_id, public_id)
    on delete cascade,
  constraint trip_confirmation_deliveries_version_check
    check (confirmation_version > 0),
  constraint trip_confirmation_deliveries_status_check
    check (status in ('pending', 'sending', 'sent', 'failed')),
  constraint trip_confirmation_deliveries_attempt_count_check
    check (attempt_count >= 0),
  constraint trip_confirmation_deliveries_email_check
    check (btrim(to_email) <> '')
);

create index if not exists trip_confirmation_deliveries_pending_idx
  on public.trip_confirmation_deliveries (trip_id, confirmation_version, status)
  where status in ('pending', 'sending', 'failed');

do $drop_browser_policies$
declare
  existing_policy record;
begin
  for existing_policy in
    select schemaname, tablename, policyname
    from pg_catalog.pg_policies
    where
      schemaname = 'public' and
      tablename in ('trips', 'trip_responses', 'trip_confirmation_deliveries')
  loop
    execute format(
      'drop policy %I on %I.%I',
      existing_policy.policyname,
      existing_policy.schemaname,
      existing_policy.tablename
    );
  end loop;
end;
$drop_browser_policies$;

alter table public.trips enable row level security;
alter table public.trip_responses enable row level security;
alter table public.trip_confirmation_deliveries enable row level security;

revoke all on table public.trips from public, anon, authenticated;
revoke all on table public.trip_responses from public, anon, authenticated;
revoke all on table public.trip_confirmation_deliveries from public, anon, authenticated;

grant select, insert, update, delete on table public.trips to service_role;
grant select, insert, update, delete on table public.trip_responses to service_role;
grant select, insert, update, delete on table public.trip_confirmation_deliveries to service_role;

create or replace function public.submit_trip_response(
  p_trip_id text,
  p_actor_key text,
  p_data jsonb
)
returns table (
  result_code text,
  response_public_id uuid
)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  trip_status text;
  trip_candidates jsonb;
  existing_public_id uuid;
  response_count integer;
begin
  if
    p_trip_id is null or
    btrim(p_trip_id) = '' or
    p_actor_key is null or
    btrim(p_actor_key) = '' or
    p_data is null or
    jsonb_typeof(p_data) is distinct from 'object' or
    jsonb_typeof(p_data->'selectedDates') is distinct from 'array'
  then
    return query select 'invalid_argument'::text, null::uuid;
    return;
  end if;

  select trips.status, trips.data->'selectedDates'
  into trip_status, trip_candidates
  from public.trips as trips
  where trips.id = p_trip_id
  for update;

  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  if trip_status <> 'collecting' then
    return query select 'trip_confirmed'::text, null::uuid;
    return;
  end if;

  if jsonb_typeof(trip_candidates) is distinct from 'array' then
    return query select 'date_not_proposed'::text, null::uuid;
    return;
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(p_data->'selectedDates') as selected(date_text)
    where not (trip_candidates ? selected.date_text)
  ) then
    return query select 'date_not_proposed'::text, null::uuid;
    return;
  end if;

  select responses.public_id
  into existing_public_id
  from public.trip_responses as responses
  where responses.trip_id = p_trip_id and responses.person_key = p_actor_key;

  if found then
    update public.trip_responses as responses
    set
      data = p_data,
      updated_at = clock_timestamp()
    where responses.trip_id = p_trip_id and responses.person_key = p_actor_key;

    return query select 'updated'::text, existing_public_id;
    return;
  end if;

  select count(*)::integer
  into response_count
  from public.trip_responses as responses
  where responses.trip_id = p_trip_id;

  if response_count >= 100 then
    return query select 'capacity_reached'::text, null::uuid;
    return;
  end if;

  insert into public.trip_responses as responses (
    trip_id,
    person_key,
    data,
    updated_at
  )
  values (
    p_trip_id,
    p_actor_key,
    p_data,
    clock_timestamp()
  )
  returning responses.public_id into existing_public_id;

  return query select 'created'::text, existing_public_id;
end;
$$;

create or replace function public.confirm_trip_once(
  p_trip_id text,
  p_actor_key text,
  p_date text
)
returns table (
  result_code text,
  confirmation_version integer
)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  trip_status text;
  organizer_key text;
  trip_data jsonb;
  active_date date;
  active_version integer;
  requested_date date;
begin
  if
    p_trip_id is null or
    btrim(p_trip_id) = '' or
    p_actor_key is null or
    btrim(p_actor_key) = '' or
    p_date is null or
    p_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  then
    return query select 'invalid_argument'::text, null::integer;
    return;
  end if;

  begin
    requested_date := p_date::date;
  exception
    when datetime_field_overflow or invalid_datetime_format then
      return query select 'invalid_candidate'::text, null::integer;
      return;
  end;

  select
    trips.status,
    trips.organizer_actor_key,
    trips.data,
    trips.confirmed_date,
    trips.confirmation_version
  into
    trip_status,
    organizer_key,
    trip_data,
    active_date,
    active_version
  from public.trips as trips
  where trips.id = p_trip_id
  for update;

  if not found then
    return query select 'not_found'::text, null::integer;
    return;
  end if;

  if organizer_key is distinct from p_actor_key then
    return query select 'forbidden'::text, active_version;
    return;
  end if;

  if trip_status = 'confirmed' then
    if active_date = requested_date then
      return query select 'already_confirmed'::text, active_version;
    else
      return query select 'conflict'::text, active_version;
    end if;
    return;
  end if;

  if
    jsonb_typeof(trip_data->'selectedDates') is distinct from 'array' or
    not ((trip_data->'selectedDates') ? p_date)
  then
    return query select 'invalid_candidate'::text, active_version;
    return;
  end if;

  update public.trips as trips
  set
    status = 'confirmed',
    confirmed_date = requested_date,
    confirmed_at = clock_timestamp(),
    confirmation_version = trips.confirmation_version + 1,
    updated_at = clock_timestamp(),
    data = jsonb_set(
      coalesce(trips.data, '{}'::jsonb),
      '{confirmedDate}',
      to_jsonb(p_date),
      true
    )
  where trips.id = p_trip_id
  returning trips.confirmation_version into active_version;

  insert into public.trip_confirmation_deliveries (
    trip_id,
    confirmation_version,
    response_public_id,
    to_email
  )
  select
    p_trip_id,
    active_version,
    responses.public_id,
    lower(btrim(responses.data->>'email'))
  from public.trip_responses as responses
  where
    responses.trip_id = p_trip_id and
    nullif(btrim(responses.data->>'email'), '') is not null
  -- Target the primary key by name: a bare `confirmation_version` column
  -- reference here is ambiguous with this function's OUT parameter.
  on conflict on constraint trip_confirmation_deliveries_pkey do nothing;

  return query select 'confirmed'::text, active_version;
end;
$$;

create or replace function public.claim_confirmation_deliveries(
  p_trip_id text,
  p_actor_key text,
  p_confirmation_version integer
)
returns table (
  result_code text,
  response_public_id uuid,
  to_email text
)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  trip_status text;
  organizer_key text;
  active_version integer;
begin
  if
    p_trip_id is null or
    btrim(p_trip_id) = '' or
    p_actor_key is null or
    btrim(p_actor_key) = '' or
    p_confirmation_version is null or
    p_confirmation_version < 1
  then
    return query select 'invalid_argument'::text, null::uuid, null::text;
    return;
  end if;

  select trips.status, trips.organizer_actor_key, trips.confirmation_version
  into trip_status, organizer_key, active_version
  from public.trips as trips
  where trips.id = p_trip_id
  for update;

  if not found then
    return query select 'not_found'::text, null::uuid, null::text;
    return;
  end if;
  if organizer_key is null or organizer_key <> p_actor_key then
    return query select 'forbidden'::text, null::uuid, null::text;
    return;
  end if;
  if trip_status <> 'confirmed' or active_version <> p_confirmation_version then
    return query select 'conflict'::text, null::uuid, null::text;
    return;
  end if;

  return query
  with claimed as (
    update public.trip_confirmation_deliveries as deliveries
    set
      status = 'sending',
      attempt_count = deliveries.attempt_count + 1,
      last_error = null,
      updated_at = clock_timestamp()
    where
      deliveries.trip_id = p_trip_id and
      deliveries.confirmation_version = p_confirmation_version and
      (
        deliveries.status in ('pending', 'failed') or
        (
          deliveries.status = 'sending' and
          deliveries.updated_at < clock_timestamp() - interval '10 minutes'
        )
      )
    returning deliveries.response_public_id, deliveries.to_email
  )
  select
    'claimed'::text,
    claimed.response_public_id,
    claimed.to_email
  from claimed;

  if not found then
    return query select 'none'::text, null::uuid, null::text;
  end if;
end;
$$;

create or replace function public.complete_confirmation_delivery(
  p_trip_id text,
  p_actor_key text,
  p_confirmation_version integer,
  p_response_public_id uuid,
  p_succeeded boolean
)
returns table (
  result_code text
)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  organizer_key text;
begin
  if
    p_trip_id is null or
    btrim(p_trip_id) = '' or
    p_actor_key is null or
    btrim(p_actor_key) = '' or
    p_confirmation_version is null or
    p_confirmation_version < 1 or
    p_response_public_id is null or
    p_succeeded is null
  then
    return query select 'invalid_argument'::text;
    return;
  end if;

  select trips.organizer_actor_key
  into organizer_key
  from public.trips as trips
  where trips.id = p_trip_id;

  if not found then
    return query select 'not_found'::text;
    return;
  end if;
  if organizer_key is null or organizer_key <> p_actor_key then
    return query select 'forbidden'::text;
    return;
  end if;

  update public.trip_confirmation_deliveries as deliveries
  set
    status = case when p_succeeded then 'sent' else 'failed' end,
    sent_at = case when p_succeeded then clock_timestamp() else null end,
    last_error = case when p_succeeded then null else 'delivery_failed' end,
    updated_at = clock_timestamp()
  where
    deliveries.trip_id = p_trip_id and
    deliveries.confirmation_version = p_confirmation_version and
    deliveries.response_public_id = p_response_public_id and
    deliveries.status = 'sending';

  if not found then
    return query select 'conflict'::text;
    return;
  end if;

  return query select 'completed'::text;
end;
$$;

create or replace function public.reopen_trip(
  p_trip_id text,
  p_actor_key text
)
returns table (
  result_code text,
  confirmation_version integer
)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  trip_status text;
  organizer_key text;
  active_version integer;
begin
  if
    p_trip_id is null or
    btrim(p_trip_id) = '' or
    p_actor_key is null or
    btrim(p_actor_key) = ''
  then
    return query select 'invalid_argument'::text, null::integer;
    return;
  end if;

  select
    trips.status,
    trips.organizer_actor_key,
    trips.confirmation_version
  into
    trip_status,
    organizer_key,
    active_version
  from public.trips as trips
  where trips.id = p_trip_id
  for update;

  if not found then
    return query select 'not_found'::text, null::integer;
    return;
  end if;

  if organizer_key is distinct from p_actor_key then
    return query select 'forbidden'::text, active_version;
    return;
  end if;

  if trip_status = 'collecting' then
    return query select 'already_collecting'::text, active_version;
    return;
  end if;

  update public.trips as trips
  set
    status = 'collecting',
    confirmed_date = null,
    confirmed_at = null,
    updated_at = clock_timestamp(),
    data = jsonb_set(
      coalesce(trips.data, '{}'::jsonb),
      '{confirmedDate}',
      'null'::jsonb,
      true
    )
  where trips.id = p_trip_id;

  return query select 'reopened'::text, active_version;
end;
$$;

revoke all on function public.submit_trip_response(text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.confirm_trip_once(text, text, text)
  from public, anon, authenticated;
revoke all on function public.claim_confirmation_deliveries(text, text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_confirmation_delivery(text, text, integer, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.reopen_trip(text, text)
  from public, anon, authenticated;

grant execute on function public.submit_trip_response(text, text, jsonb)
  to service_role;
grant execute on function public.confirm_trip_once(text, text, text)
  to service_role;
grant execute on function public.claim_confirmation_deliveries(text, text, integer)
  to service_role;
grant execute on function public.complete_confirmation_delivery(text, text, integer, uuid, boolean)
  to service_role;
grant execute on function public.reopen_trip(text, text)
  to service_role;
