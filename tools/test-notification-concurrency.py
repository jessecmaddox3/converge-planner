"""Exercise the worker claim under two real Postgres transactions, on local test DBs only."""
import os
import subprocess
import select

if os.environ.get("PGHOST") not in ("127.0.0.1", "localhost") or not (os.environ.get("PGDATABASE") == "converge_test" or os.environ.get("PGDATABASE", "").startswith("converge_contract_")):
    raise SystemExit("Disposable local test database required")

command = ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"]
def query(sql):
    return subprocess.check_output(command + ["-c", sql], text=True, timeout=15).strip()

trip_id = "__notification_concurrency__"
first = None
try:
    query("""insert into public.trips(id,data,organizer_actor_key) values ('__notification_concurrency__','{"selectedDates":["2026-10-09"]}','account:concurrency');
      select * from public.submit_trip_response('__notification_concurrency__','capability:concurrency','{"name":"Test","email":"test@example.com","selectedDates":["2026-10-09"]}');
      select * from public.confirm_trip_once('__notification_concurrency__','account:concurrency','2026-10-09');""")
    first = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first.stdin.write("begin; set local role service_role; select count(*) from public.claim_notification_batch('__notification_concurrency__',3);\n")
    first.stdin.flush()
    assert select.select([first.stdout], [], [], 10)[0], "First transaction timed out"
    assert first.stdout.readline().strip() == "1", "First transaction did not claim the delivery"
    # The first client holds the trip lock. The second must skip it without waiting.
    assert query("set role service_role; select count(*) from public.claim_notification_batch('__notification_concurrency__',3)") == "0", "Concurrent transaction claimed or waited on locked work"
    first.stdin.write("commit;\n")
    first.stdin.close()
    assert first.wait(timeout=5) == 0
    assert query("set role service_role; select count(*) from public.claim_notification_batch('__notification_concurrency__',3)") == "0", "Active lease claimed twice"
    query("update public.trip_confirmation_deliveries set lease_expires_at=clock_timestamp()-interval '1 second' where trip_id='__notification_concurrency__'")
    assert query("set role service_role; select count(*) from public.claim_notification_batch('__notification_concurrency__',3)") == "1", "Expired lease did not recover"
    print("Notification concurrency contract passed")
finally:
    if first and first.poll() is None:
        first.kill()
        first.wait()
    query("delete from public.trips where id='__notification_concurrency__'")
