create table if not exists public.api_rate_limit_counters (
  key text not null,
  bucket_start bigint not null,
  count integer not null check (count >= 0),
  updated_at timestamptz not null default now(),
  primary key (key, bucket_start)
);

alter table public.api_rate_limit_counters enable row level security;

revoke all on table public.api_rate_limit_counters from public, anon, authenticated;
grant select, insert, update on table public.api_rate_limit_counters to service_role;

create or replace function public.consume_rate_limit(
  p_key text,
  p_window_seconds integer,
  p_limit integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after integer
)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_now bigint;
  v_bucket_start bigint;
  v_count integer;
begin
  if
    p_key is null or
    p_key = '' or
    p_window_seconds is null or
    p_window_seconds < 1 or
    p_window_seconds > 86400 or
    p_limit is null or
    p_limit < 1 or
    p_limit > 10000
  then
    raise exception using errcode = '22023', message = 'invalid rate-limit arguments';
  end if;

  v_now := floor(extract(epoch from clock_timestamp()))::bigint;
  v_bucket_start := (v_now / p_window_seconds) * p_window_seconds;

  insert into public.api_rate_limit_counters as counters (
    key,
    bucket_start,
    count,
    updated_at
  )
  values (
    p_key,
    v_bucket_start,
    1,
    clock_timestamp()
  )
  on conflict (key, bucket_start) do update
  set
    count = least(counters.count + 1, p_limit + 1),
    updated_at = clock_timestamp()
  returning count into v_count;

  return query
  select
    v_count <= p_limit,
    greatest(p_limit - v_count, 0),
    case
      when v_count <= p_limit then 0
      else (v_bucket_start + p_window_seconds - v_now)::integer
    end;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer)
  to service_role;
