begin;
create table if not exists public.ai_daily_budget (
  day date primary key,
  committed_micros bigint not null default 0 check (committed_micros >= 0)
);
create table if not exists public.ai_generation_usage (
  id uuid primary key default gen_random_uuid(),
  day date not null references public.ai_daily_budget(day),
  reserved_micros integer not null check (reserved_micros > 0),
  actual_micros integer check (actual_micros >= 0),
  metadata jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.ai_daily_budget enable row level security;
alter table public.ai_generation_usage enable row level security;
revoke all on public.ai_daily_budget, public.ai_generation_usage from public, anon, authenticated;
grant all on public.ai_daily_budget, public.ai_generation_usage to service_role;

create or replace function public.reserve_ai_generation(p_reserved_micros integer, p_daily_limit_micros integer)
returns table(allowed boolean, reservation_id uuid, retry_after integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare today date := (clock_timestamp() at time zone 'UTC')::date; committed bigint; reservation uuid;
begin
  if p_reserved_micros is null or p_reserved_micros not between 1 and 1000000 or p_daily_limit_micros is null or p_daily_limit_micros not between 0 and 100000000 then raise exception 'INVALID_BUDGET_INPUT'; end if;
  insert into public.ai_daily_budget(day) values(today) on conflict(day) do nothing;
  select committed_micros into committed from public.ai_daily_budget where day = today for update;
  if committed + p_reserved_micros > p_daily_limit_micros then
    return query select false, null::uuid, greatest(1, ceil(extract(epoch from (((today + 1)::timestamp at time zone 'UTC') - clock_timestamp())))::integer); return;
  end if;
  update public.ai_daily_budget set committed_micros = committed_micros + p_reserved_micros where day = today;
  insert into public.ai_generation_usage(day, reserved_micros) values(today, p_reserved_micros) returning id into reservation;
  return query select true, reservation, 0;
end $$;

create or replace function public.record_ai_generation(p_reservation_id uuid, p_actual_micros integer, p_metadata jsonb)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare usage public.ai_generation_usage%rowtype;
begin
  if p_actual_micros < 0 or p_actual_micros > 1000000 or p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then raise exception 'INVALID_USAGE_INPUT'; end if;
  if exists(select 1 from jsonb_object_keys(p_metadata) k where k not in ('model','promptVersion','cacheHit','latencyMs','inputTokens','outputTokens','thinkingTokens','finishReason','validated','eventCount')) then raise exception 'INVALID_USAGE_METADATA'; end if;
  select * into usage from public.ai_generation_usage where id = p_reservation_id for update;
  if not found or usage.finished_at is not null then return false; end if;
  if p_actual_micros is not null then
    update public.ai_daily_budget set committed_micros = committed_micros + p_actual_micros - usage.reserved_micros where day = usage.day;
  end if;
  update public.ai_generation_usage set actual_micros = p_actual_micros, metadata = p_metadata, finished_at = clock_timestamp() where id = p_reservation_id;
  return true;
end $$;
revoke all on function public.reserve_ai_generation(integer,integer), public.record_ai_generation(uuid,integer,jsonb) from public, anon, authenticated;
grant execute on function public.reserve_ai_generation(integer,integer), public.record_ai_generation(uuid,integer,jsonb) to service_role;
commit;
