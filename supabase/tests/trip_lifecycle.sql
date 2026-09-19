begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void
language plpgsql
as $$
begin
  if condition is not true then
    raise exception 'assertion failed: %', message;
  end if;
end;
$$;

do $$
begin
  perform pg_temp.assert_true(
    exists (
      select 1
      from pg_catalog.pg_constraint as constraints
      where
        constraints.conrelid = 'public.trips'::regclass and
        constraints.contype = 'p' and
        constraints.conkey = array[
          (
            select attributes.attnum
            from pg_catalog.pg_attribute as attributes
            where
              attributes.attrelid = 'public.trips'::regclass and
              attributes.attname = 'id'
          )
        ]::smallint[]
    ),
    'trips has an id primary key'
  );
  perform pg_temp.assert_true(
    exists (
      select 1
      from pg_catalog.pg_constraint as constraints
      where
        constraints.conrelid = 'public.trip_responses'::regclass and
        constraints.contype = 'p' and
        constraints.conkey = array[
          (
            select attributes.attnum
            from pg_catalog.pg_attribute as attributes
            where
              attributes.attrelid = 'public.trip_responses'::regclass and
              attributes.attname = 'trip_id'
          ),
          (
            select attributes.attnum
            from pg_catalog.pg_attribute as attributes
            where
              attributes.attrelid = 'public.trip_responses'::regclass and
              attributes.attname = 'person_key'
          )
        ]::smallint[]
    ),
    'trip_responses has the trip and actor primary key'
  );
  perform pg_temp.assert_true(
    exists (
      select 1
      from pg_catalog.pg_constraint as constraints
      where
        constraints.conrelid = 'public.trip_responses'::regclass and
        constraints.confrelid = 'public.trips'::regclass and
        constraints.contype = 'f' and
        constraints.confdeltype = 'c' and
        constraints.conkey = array[
          (
            select attributes.attnum
            from pg_catalog.pg_attribute as attributes
            where
              attributes.attrelid = 'public.trip_responses'::regclass and
              attributes.attname = 'trip_id'
          )
        ]::smallint[]
    ),
    'trip_responses cascades from its trip foreign key'
  );
end;
$$;

insert into public.trips (
  id,
  data,
  status,
  organizer_actor_key,
  organizer_email_normalized
)
values
  (
    '__lifecycle_contract_main__',
    jsonb_build_object(
      'id', '__lifecycle_contract_main__',
      'name', 'Lifecycle contract',
      'selectedDates', jsonb_build_array('2026-10-02', '2026-10-09'),
      'confirmedDate', null,
      'organizerEmail', 'OWNER@EXAMPLE.COM'
    ),
    'collecting',
    'account:organizer',
    'owner@example.com'
  ),
  (
    '__lifecycle_contract_capacity__',
    jsonb_build_object(
      'id', '__lifecycle_contract_capacity__',
      'name', 'Capacity contract',
      'selectedDates', jsonb_build_array('2026-10-02'),
      'confirmedDate', null
    ),
    'collecting',
    'account:organizer',
    'owner@example.com'
  );

do $$
declare
  first_result record;
  update_result record;
  second_result record;
  outside_result record;
  original_public_id uuid;
begin
  select * into first_result
  from public.submit_trip_response(
    '__lifecycle_contract_main__',
    'account:respondent-a',
    jsonb_build_object(
      'name', 'Alex',
      'email', 'alex@example.com',
      'selectedDates', jsonb_build_array('2026-10-02'),
      'preferences', jsonb_build_object('2026-10-02', 'available'),
      'conflictCount', 0
    )
  );
  perform pg_temp.assert_true(first_result.result_code = 'created', 'collecting response is created');
  perform pg_temp.assert_true(first_result.response_public_id is not null, 'created response has a public UUID');
  original_public_id := first_result.response_public_id;

  select * into update_result
  from public.submit_trip_response(
    '__lifecycle_contract_main__',
    'account:respondent-a',
    jsonb_build_object(
      'name', 'Alex Updated',
      'email', 'alex@example.com',
      'selectedDates', jsonb_build_array(),
      'preferences', jsonb_build_object(),
      'conflictCount', 1
    )
  );
  perform pg_temp.assert_true(update_result.result_code = 'updated', 'existing actor is updated');
  perform pg_temp.assert_true(update_result.response_public_id = original_public_id, 'response public UUID is stable');
  perform pg_temp.assert_true(
    (select count(*) from public.trip_responses
      where trip_id = '__lifecycle_contract_main__' and person_key = 'account:respondent-a') = 1,
    'response upsert retains one actor row'
  );
  perform pg_temp.assert_true(
    (select data->>'name' from public.trip_responses
      where trip_id = '__lifecycle_contract_main__' and person_key = 'account:respondent-a') = 'Alex Updated',
    'response upsert replaces data'
  );

  select * into second_result
  from public.submit_trip_response(
    '__lifecycle_contract_main__',
    'capability:respondent-b',
    jsonb_build_object(
      'name', 'Alex Updated',
      'email', 'second@example.com',
      'selectedDates', jsonb_build_array('2026-10-09'),
      'preferences', jsonb_build_object('2026-10-09', 'preferred'),
      'conflictCount', 0
    )
  );
  perform pg_temp.assert_true(second_result.result_code = 'created', 'same display name does not collide');
  perform pg_temp.assert_true(second_result.response_public_id <> original_public_id, 'actors receive distinct public UUIDs');

  select * into outside_result
  from public.submit_trip_response(
    '__lifecycle_contract_main__',
    'account:outside-candidate',
    jsonb_build_object(
      'name', 'Outside',
      'selectedDates', jsonb_build_array('2026-10-16'),
      'preferences', jsonb_build_object(),
      'conflictCount', 0
    )
  );
  perform pg_temp.assert_true(outside_result.result_code = 'date_not_proposed', 'response dates remain candidate-only');
end;
$$;

do $$
declare
  invalid_candidate record;
  forbidden_result record;
  confirmed_result record;
  same_date_result record;
  different_date_result record;
  blocked_response record;
  delivery_count integer;
begin
  select * into invalid_candidate
  from public.confirm_trip_once(
    '__lifecycle_contract_main__',
    'account:organizer',
    '2026-10-16'
  );
  perform pg_temp.assert_true(invalid_candidate.result_code = 'invalid_candidate', 'confirmation is candidate-only');

  select * into forbidden_result
  from public.confirm_trip_once(
    '__lifecycle_contract_main__',
    'account:not-organizer',
    '2026-10-02'
  );
  perform pg_temp.assert_true(forbidden_result.result_code = 'forbidden', 'only organizer may confirm');

  select * into confirmed_result
  from public.confirm_trip_once(
    '__lifecycle_contract_main__',
    'account:organizer',
    '2026-10-02'
  );
  perform pg_temp.assert_true(confirmed_result.result_code = 'confirmed', 'first candidate confirmation wins');
  perform pg_temp.assert_true(confirmed_result.confirmation_version = 1, 'first confirmation has version one');
  perform pg_temp.assert_true(
    (select status = 'confirmed' and confirmed_date = date '2026-10-02'
      from public.trips where id = '__lifecycle_contract_main__'),
    'authoritative confirmation columns are updated'
  );
  perform pg_temp.assert_true(
    (select data->>'confirmedDate' = '2026-10-02'
      from public.trips where id = '__lifecycle_contract_main__'),
    'legacy JSON confirmation stays synchronized'
  );

  select count(*) into delivery_count
  from public.trip_confirmation_deliveries
  where trip_id = '__lifecycle_contract_main__' and confirmation_version = 1;
  perform pg_temp.assert_true(delivery_count = 2, 'one pending delivery is created per response with email');
  perform pg_temp.assert_true(
    (select count(*) = count(distinct response_public_id)
      from public.trip_confirmation_deliveries
      where trip_id = '__lifecycle_contract_main__' and confirmation_version = 1),
    'delivery rows are unique per response and confirmation version'
  );
  perform pg_temp.assert_true(
    (select bool_and(status = 'pending')
      from public.trip_confirmation_deliveries
      where trip_id = '__lifecycle_contract_main__' and confirmation_version = 1),
    'new delivery work is pending'
  );

  select * into same_date_result
  from public.confirm_trip_once(
    '__lifecycle_contract_main__',
    'account:organizer',
    '2026-10-02'
  );
  perform pg_temp.assert_true(same_date_result.result_code = 'already_confirmed', 'same-date confirmation is idempotent');
  perform pg_temp.assert_true(same_date_result.confirmation_version = 1, 'same-date confirmation preserves version');
  perform pg_temp.assert_true(
    (select count(*) from public.trip_confirmation_deliveries
      where trip_id = '__lifecycle_contract_main__' and confirmation_version = 1) = delivery_count,
    'same-date retry creates no duplicate delivery work'
  );

  select * into different_date_result
  from public.confirm_trip_once(
    '__lifecycle_contract_main__',
    'account:organizer',
    '2026-10-09'
  );
  perform pg_temp.assert_true(different_date_result.result_code = 'conflict', 'different date conflicts while confirmed');
  perform pg_temp.assert_true(
    (select confirmed_date = date '2026-10-02'
      from public.trips where id = '__lifecycle_contract_main__'),
    'losing confirmation cannot change the winning date'
  );

  select * into blocked_response
  from public.submit_trip_response(
    '__lifecycle_contract_main__',
    'account:respondent-a',
    jsonb_build_object(
      'name', 'Blocked',
      'selectedDates', jsonb_build_array(),
      'preferences', jsonb_build_object(),
      'conflictCount', 0
    )
  );
  perform pg_temp.assert_true(blocked_response.result_code = 'trip_confirmed', 'confirmed trip rejects response writes');
end;
$$;

do $$
declare
  claimed_ids uuid[];
  second_claim record;
  forbidden_claim record;
  completion record;
  retry_claim record;
  stale_claim record;
  losing_completion record;
  forbidden_completion record;
  final_claim record;
begin
  select array_agg(response_public_id order by response_public_id)
  into claimed_ids
  from public.claim_confirmation_deliveries(
    '__lifecycle_contract_main__',
    'account:organizer',
    1
  )
  where result_code = 'claimed';
  perform pg_temp.assert_true(
    coalesce(array_length(claimed_ids, 1), 0) = 2,
    'organizer claims each pending delivery exactly once'
  );
  perform pg_temp.assert_true(
    (select bool_and(status = 'sending' and attempt_count = 1)
      from public.trip_confirmation_deliveries
      where trip_id = '__lifecycle_contract_main__' and confirmation_version = 1),
    'claim marks delivery work sending and increments attempts'
  );

  select * into second_claim
  from public.claim_confirmation_deliveries(
    '__lifecycle_contract_main__',
    'account:organizer',
    1
  );
  perform pg_temp.assert_true(
    second_claim.result_code = 'none',
    'concurrent retry cannot claim in-flight delivery work'
  );

  select * into forbidden_claim
  from public.claim_confirmation_deliveries(
    '__lifecycle_contract_main__',
    'account:not-organizer',
    1
  );
  perform pg_temp.assert_true(
    forbidden_claim.result_code = 'forbidden',
    'only organizer may claim confirmation deliveries'
  );

  select * into completion
  from public.complete_confirmation_delivery(
    '__lifecycle_contract_main__',
    'account:organizer',
    1,
    claimed_ids[1],
    true
  );
  perform pg_temp.assert_true(completion.result_code = 'completed', 'successful delivery completes');

  select * into completion
  from public.complete_confirmation_delivery(
    '__lifecycle_contract_main__',
    'account:organizer',
    1,
    claimed_ids[2],
    false
  );
  perform pg_temp.assert_true(completion.result_code = 'completed', 'failed delivery records failure');

  select * into retry_claim
  from public.claim_confirmation_deliveries(
    '__lifecycle_contract_main__',
    'account:organizer',
    1
  );
  perform pg_temp.assert_true(
    retry_claim.result_code = 'claimed' and
    retry_claim.response_public_id = claimed_ids[2],
    'same-date retry claims only failed delivery work'
  );
  perform pg_temp.assert_true(
    (select attempt_count = 2
      from public.trip_confirmation_deliveries
      where
        trip_id = '__lifecycle_contract_main__' and
        confirmation_version = 1 and
        response_public_id = claimed_ids[2]),
    'failed delivery retry increments attempt count'
  );

  select * into completion
  from public.complete_confirmation_delivery(
    '__lifecycle_contract_main__',
    'account:organizer',
    1,
    claimed_ids[2],
    true
  );
  perform pg_temp.assert_true(completion.result_code = 'completed', 'retried delivery completes');

  update public.trip_confirmation_deliveries
  set
    status = 'sending',
    updated_at = clock_timestamp() - interval '11 minutes'
  where
    trip_id = '__lifecycle_contract_main__' and
    confirmation_version = 1 and
    response_public_id = claimed_ids[1];

  select * into stale_claim
  from public.claim_confirmation_deliveries(
    '__lifecycle_contract_main__',
    'account:organizer',
    1
  );
  perform pg_temp.assert_true(
    stale_claim.result_code = 'claimed' and
    stale_claim.response_public_id = claimed_ids[1],
    'stale sending work can be reclaimed'
  );
  perform pg_temp.assert_true(
    (select attempt_count = 2
      from public.trip_confirmation_deliveries
      where
        trip_id = '__lifecycle_contract_main__' and
        confirmation_version = 1 and
        response_public_id = claimed_ids[1]),
    'stale reclaim increments attempt count'
  );

  select * into completion
  from public.complete_confirmation_delivery(
    '__lifecycle_contract_main__',
    'account:organizer',
    1,
    claimed_ids[1],
    true
  );
  perform pg_temp.assert_true(completion.result_code = 'completed', 'stale retry completes');

  select * into losing_completion
  from public.complete_confirmation_delivery(
    '__lifecycle_contract_main__',
    'account:organizer',
    1,
    claimed_ids[1],
    false
  );
  perform pg_temp.assert_true(
    losing_completion.result_code = 'conflict',
    'late completion cannot overwrite sent delivery state'
  );

  select * into forbidden_completion
  from public.complete_confirmation_delivery(
    '__lifecycle_contract_main__',
    'account:not-organizer',
    1,
    claimed_ids[1],
    true
  );
  perform pg_temp.assert_true(
    forbidden_completion.result_code = 'forbidden',
    'only organizer may complete confirmation deliveries'
  );

  select * into final_claim
  from public.claim_confirmation_deliveries(
    '__lifecycle_contract_main__',
    'account:organizer',
    1
  );
  perform pg_temp.assert_true(
    final_claim.result_code = 'none',
    'completed deliveries are not claimed again'
  );
end;
$$;

do $$
declare
  forbidden_result record;
  reopened_result record;
  repeated_result record;
  post_reopen_response record;
  second_confirmation record;
  post_reopen_conflict record;
  version_two_delivery_count integer;
begin
  select * into forbidden_result
  from public.reopen_trip('__lifecycle_contract_main__', 'account:not-organizer');
  perform pg_temp.assert_true(forbidden_result.result_code = 'forbidden', 'only organizer may reopen');

  select * into reopened_result
  from public.reopen_trip('__lifecycle_contract_main__', 'account:organizer');
  perform pg_temp.assert_true(reopened_result.result_code = 'reopened', 'confirmed trip reopens');
  perform pg_temp.assert_true(reopened_result.confirmation_version = 1, 'reopen preserves confirmation version');
  perform pg_temp.assert_true(
    (select status = 'collecting' and confirmed_date is null and confirmed_at is null
      from public.trips where id = '__lifecycle_contract_main__'),
    'reopen clears active confirmation columns'
  );
  perform pg_temp.assert_true(
    (select data->'confirmedDate' = 'null'::jsonb
      from public.trips where id = '__lifecycle_contract_main__'),
    'reopen clears legacy JSON confirmation'
  );

  select * into repeated_result
  from public.reopen_trip('__lifecycle_contract_main__', 'account:organizer');
  perform pg_temp.assert_true(repeated_result.result_code = 'already_collecting', 'reopen is idempotent');

  select * into post_reopen_response
  from public.submit_trip_response(
    '__lifecycle_contract_main__',
    'account:respondent-a',
    jsonb_build_object(
      'name', 'After Reopen',
      'email', 'alex@example.com',
      'selectedDates', jsonb_build_array('2026-10-09'),
      'preferences', jsonb_build_object(),
      'conflictCount', 0
    )
  );
  perform pg_temp.assert_true(post_reopen_response.result_code = 'updated', 'reopen restores response writes');

  select * into second_confirmation
  from public.confirm_trip_once(
    '__lifecycle_contract_main__',
    'account:organizer',
    '2026-10-09'
  );
  perform pg_temp.assert_true(second_confirmation.result_code = 'confirmed', 'trip confirms again after reopen');
  perform pg_temp.assert_true(second_confirmation.confirmation_version = 2, 'confirmation version increments after reopen');
  perform pg_temp.assert_true(
    (select status = 'confirmed' and confirmed_date = date '2026-10-09' and confirmation_version = 2
      from public.trips where id = '__lifecycle_contract_main__'),
    'second confirmation becomes authoritative'
  );

  select count(*) into version_two_delivery_count
  from public.trip_confirmation_deliveries
  where trip_id = '__lifecycle_contract_main__' and confirmation_version = 2;
  perform pg_temp.assert_true(version_two_delivery_count = 2, 'second confirmation creates one delivery per emailed response');
  perform pg_temp.assert_true(
    (select count(*) = count(distinct response_public_id)
      from public.trip_confirmation_deliveries
      where trip_id = '__lifecycle_contract_main__' and confirmation_version = 2),
    'second confirmation delivery rows are unique for the new version'
  );

  select * into post_reopen_conflict
  from public.confirm_trip_once(
    '__lifecycle_contract_main__',
    'account:organizer',
    '2026-10-02'
  );
  perform pg_temp.assert_true(post_reopen_conflict.result_code = 'conflict', 'different-date conflict still applies after reopen');
  perform pg_temp.assert_true(
    (select confirmed_date = date '2026-10-09' and confirmation_version = 2
      from public.trips where id = '__lifecycle_contract_main__'),
    'post-reopen conflict preserves the second winning date and version'
  );
end;
$$;

insert into public.trip_responses (trip_id, person_key, data)
select
  '__lifecycle_contract_capacity__',
  'capacity-actor-' || series::text,
  jsonb_build_object(
    'name', 'Person ' || series::text,
    'selectedDates', jsonb_build_array(),
    'preferences', jsonb_build_object(),
    'conflictCount', 0
  )
from generate_series(1, 100) as series;

do $$
declare
  capacity_result record;
  existing_result record;
  existing_public_id uuid;
begin
  select public_id into existing_public_id
  from public.trip_responses
  where trip_id = '__lifecycle_contract_capacity__' and person_key = 'capacity-actor-1';

  select * into capacity_result
  from public.submit_trip_response(
    '__lifecycle_contract_capacity__',
    'capacity-actor-101',
    jsonb_build_object(
      'name', 'Person 101',
      'selectedDates', jsonb_build_array(),
      'preferences', jsonb_build_object(),
      'conflictCount', 0
    )
  );
  perform pg_temp.assert_true(capacity_result.result_code = 'capacity_reached', 'new actor is rejected at capacity');
  perform pg_temp.assert_true(
    (select count(*) from public.trip_responses where trip_id = '__lifecycle_contract_capacity__') = 100,
    'capacity rejection leaves exactly one hundred responses'
  );

  select * into existing_result
  from public.submit_trip_response(
    '__lifecycle_contract_capacity__',
    'capacity-actor-1',
    jsonb_build_object(
      'name', 'Updated at capacity',
      'selectedDates', jsonb_build_array('2026-10-02'),
      'preferences', jsonb_build_object(),
      'conflictCount', 0
    )
  );
  perform pg_temp.assert_true(existing_result.result_code = 'updated', 'existing actor may update at capacity');
  perform pg_temp.assert_true(existing_result.response_public_id = existing_public_id, 'capacity update preserves public UUID');
end;
$$;

do $$
begin
  perform pg_temp.assert_true(
    not has_function_privilege('anon', 'public.submit_trip_response(text,text,jsonb)', 'execute'),
    'anon cannot execute submit_trip_response'
  );
  perform pg_temp.assert_true(
    not has_function_privilege('authenticated', 'public.confirm_trip_once(text,text,text)', 'execute'),
    'authenticated cannot execute confirm_trip_once'
  );
  perform pg_temp.assert_true(
    not has_function_privilege('anon', 'public.claim_confirmation_deliveries(text,text,integer)', 'execute') and
    not has_function_privilege('authenticated', 'public.complete_confirmation_delivery(text,text,integer,uuid,boolean)', 'execute'),
    'browser roles cannot execute confirmation delivery functions'
  );
  perform pg_temp.assert_true(
    not has_function_privilege('anon', 'public.reopen_trip(text,text)', 'execute'),
    'anon cannot execute reopen_trip'
  );
  perform pg_temp.assert_true(
    has_function_privilege('service_role', 'public.submit_trip_response(text,text,jsonb)', 'execute'),
    'service_role can execute submit_trip_response'
  );
  perform pg_temp.assert_true(
    has_function_privilege('service_role', 'public.claim_confirmation_deliveries(text,text,integer)', 'execute') and
    has_function_privilege('service_role', 'public.complete_confirmation_delivery(text,text,integer,uuid,boolean)', 'execute'),
    'service_role can execute confirmation delivery functions'
  );
  perform pg_temp.assert_true(
    not has_table_privilege('anon', 'public.trips', 'select') and
    not has_table_privilege('anon', 'public.trip_responses', 'select') and
    not has_table_privilege('anon', 'public.trip_confirmation_deliveries', 'select'),
    'anon has no direct table read privileges'
  );
  perform pg_temp.assert_true(
    not has_table_privilege('authenticated', 'public.trips', 'insert') and
    not has_table_privilege('authenticated', 'public.trip_responses', 'update') and
    not has_table_privilege('authenticated', 'public.trip_confirmation_deliveries', 'delete'),
    'authenticated has no direct table write privileges'
  );
  perform pg_temp.assert_true(
    has_table_privilege('service_role', 'public.trips', 'select') and
    has_table_privilege('service_role', 'public.trip_responses', 'update') and
    has_table_privilege('service_role', 'public.trip_confirmation_deliveries', 'insert'),
    'service_role has required table privileges'
  );
  perform pg_temp.assert_true(
    (select relrowsecurity from pg_class where oid = 'public.trips'::regclass),
    'trips has RLS enabled'
  );
  perform pg_temp.assert_true(
    (select relrowsecurity from pg_class where oid = 'public.trip_responses'::regclass),
    'trip_responses has RLS enabled'
  );
  perform pg_temp.assert_true(
    (select relrowsecurity from pg_class where oid = 'public.trip_confirmation_deliveries'::regclass),
    'delivery table has RLS enabled'
  );
  perform pg_temp.assert_true(
    not exists (
      select 1
      from pg_catalog.pg_policy
      where polrelid in (
        'public.trips'::regclass,
        'public.trip_responses'::regclass,
        'public.trip_confirmation_deliveries'::regclass
      )
    ),
    'lifecycle tables expose no browser RLS policies'
  );
end;
$$;

rollback;
