begin;
do $$
declare first_claim record; second_claim record; succeeded boolean;
begin
  select * into first_claim from public.claim_cached_job('contract:cached-job', 30);
  if first_claim.state <> 'claimed' then raise exception 'first claim failed'; end if;
  select * into second_claim from public.claim_cached_job('contract:cached-job', 30);
  if second_claim.state <> 'pending' then raise exception 'concurrent work was not deduplicated'; end if;
  select public.complete_cached_job('contract:cached-job', gen_random_uuid(), '{"wrong":true}', 300) into succeeded;
  if succeeded then raise exception 'stale completion accepted'; end if;
  select public.complete_cached_job('contract:cached-job', first_claim.lease_token, '{"clusters":[]}', 300) into succeeded;
  if not succeeded then raise exception 'completion rejected'; end if;
  select * into second_claim from public.claim_cached_job('contract:cached-job', 30);
  if second_claim.state <> 'hit' or second_claim.value <> '{"clusters":[]}'::jsonb then raise exception 'empty result not cached'; end if;
  select * into second_claim from public.claim_cached_job('contract:cached-job', 30, true);
  if second_claim.state <> 'claimed' then raise exception 'explicit refresh not claimed'; end if;
  perform public.release_cached_job('contract:cached-job', first_claim.lease_token);
  if not exists(select 1 from public.cached_jobs where key = 'contract:cached-job') then raise exception 'old lease removed new work'; end if;
  perform public.release_cached_job('contract:cached-job', second_claim.lease_token);
  if exists(select 1 from public.cached_jobs where key = 'contract:cached-job') then raise exception 'failed lease not released'; end if;
  if has_function_privilege('anon', 'public.claim_cached_job(text,integer,boolean)', 'EXECUTE') then raise exception 'anon can access cache'; end if;
  if has_table_privilege('authenticated', 'public.cached_jobs', 'SELECT') then raise exception 'authenticated can read private cache'; end if;
  if exists(select 1 from pg_policies where tablename = 'cached_jobs') then raise exception 'cache has public policies'; end if;
end $$;
rollback;
