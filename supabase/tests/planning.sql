begin;
create function pg_temp.check_planning(ok boolean, detail text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'planning assertion: %', detail; end if; end $$;
insert into public.trips(id, data, status, organizer_actor_key)
values ('__planning_contract__', '{"selectedDates":["2026-10-09","2026-10-16"]}', 'collecting', 'account:owner');
select * from public.submit_trip_response('__planning_contract__', 'capability:guest', '{"name":"Alex","answerVersion":2,"answers":{"2026-10-09":"maybe"},"selectedDates":[],"preferences":{}}');
do $$ declare rejected boolean := false; begin
  begin
    perform public.submit_trip_response('__planning_contract__', 'capability:guest', '{"name":"Alex","selectedDates":[],"preferences":{}}');
  exception when others then rejected := sqlerrm like '%ANSWER_VERSION_REQUIRED%'; end;
  perform pg_temp.check_planning(rejected, 'legacy clients cannot erase partial-answer semantics');
  rejected := false;
  begin
    perform public.submit_trip_response('__planning_contract__', 'capability:other', '{"answerVersion":2,"answers":{"2026-10-23":"maybe"},"selectedDates":[],"preferences":{}}');
  exception when check_violation then rejected := true; end;
  perform pg_temp.check_planning(rejected, 'unproposed Maybe rejected in SQL');
  rejected := false;
  begin
    perform public.submit_trip_response('__planning_contract__', 'capability:other', '{"answerVersion":2,"answers":{"2026-10-09":"maybe"},"selectedDates":["2026-10-09"],"preferences":{"2026-10-09":"preferred"}}');
  exception when check_violation then rejected := true; end;
  perform pg_temp.check_planning(rejected, 'available projection cannot contradict Maybe');
end $$;
do $$ declare code text; begin
  select result_code into code from public.update_trip_planning('__planning_contract__', 'account:stranger', '{"revision":0,"requiredResponseIds":[],"expectedPeople":[],"invitationsClosed":true}');
  perform pg_temp.check_planning(code = 'forbidden', 'settings require the organizer');
  select result_code into code from public.update_trip_planning('__planning_contract__', 'account:owner', '{"revision":0,"requiredResponseIds":[],"expectedPeople":[{"id":"alex","name":"Alex","required":true}],"invitationsClosed":true}');
  perform pg_temp.check_planning(code = 'updated', 'organizer settings persist');
  select result_code into code from public.update_trip_planning('__planning_contract__', 'account:owner', '{"revision":0,"requiredResponseIds":[],"expectedPeople":[],"invitationsClosed":false}');
  perform pg_temp.check_planning(code = 'stale', 'stale settings cannot erase newer decisions');
  perform pg_temp.check_planning(not has_function_privilege('anon', 'public.update_trip_planning(text,text,jsonb)', 'EXECUTE'), 'anon cannot invoke settings RPC');
end $$;
do $$ declare rejected boolean := false; begin
  begin
    perform public.submit_trip_response('__planning_contract__', 'capability:other', '{"selectedDates":[],"preferences":{}}');
  exception when others then rejected := sqlerrm like '%INVITATIONS_CLOSED%'; end;
  perform pg_temp.check_planning(rejected, 'closing invitations protects legacy writers too');
end $$;
insert into public.trips(id,data,organizer_actor_key) values ('__legacy_planning__','{"selectedDates":["2026-10-09"],"responses":[{"name":"Alex","email":"alex@example.com","selectedDates":["2026-10-09"]}]}','account:owner');
do $$ declare code text; begin
  select result_code into code from public.update_trip_planning('__legacy_planning__','account:owner','{"revision":0,"requiredResponseIds":["legacy-9hHTZbCya6jH4rJ6DHNi0m"],"expectedPeople":[{"id":"expected","name":"Alex","required":true,"responsePublicId":"legacy-9hHTZbCya6jH4rJ6DHNi0m"}],"invitationsClosed":false}');
  perform pg_temp.check_planning(code = 'updated', 'embedded legacy response can be required and matched');
end $$;
rollback;
