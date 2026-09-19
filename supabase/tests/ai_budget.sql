begin;
do $$
declare first_reservation record; second_reservation record; start_total bigint; stamp date := (clock_timestamp() at time zone 'UTC')::date;
begin
  delete from public.ai_generation_usage where day = stamp;
  delete from public.ai_daily_budget where day = stamp;
  select * into first_reservation from public.reserve_ai_generation(6000,10000);
  if not first_reservation.allowed then raise exception 'first reservation failed'; end if;
  select * into second_reservation from public.reserve_ai_generation(6000,10000);
  if second_reservation.allowed or second_reservation.retry_after < 1 then raise exception 'budget overspend allowed'; end if;
  perform public.record_ai_generation(first_reservation.reservation_id, 1000, '{"validated":true,"inputTokens":100}');
  perform public.record_ai_generation(first_reservation.reservation_id, 0, '{"validated":true}');
  select committed_micros into start_total from public.ai_daily_budget where day = stamp;
  if start_total <> 1000 then raise exception 'completion applied more than once'; end if;
  select * into second_reservation from public.reserve_ai_generation(6000,10000);
  if not second_reservation.allowed then raise exception 'unused budget was not released'; end if;
  perform public.record_ai_generation(second_reservation.reservation_id, null, '{"validated":false,"finishReason":"timeout"}');
  select committed_micros into start_total from public.ai_daily_budget where day = stamp;
  if start_total <> 7000 then raise exception 'unknown usage reservation was released'; end if;
  if has_function_privilege('anon','public.reserve_ai_generation(integer,integer)','EXECUTE') then raise exception 'public budget reservation'; end if;
  if has_table_privilege('authenticated','public.ai_generation_usage','SELECT') then raise exception 'public usage data'; end if;
end $$;
rollback;
