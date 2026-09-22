"""Synthetic native-cluster concurrency proof; never accepts remote connections.

Called while test-database-native.ps1 owns its freshly initialized cluster.
Twenty independent psql backends cross an autocommit barrier for each phase.
Ten rounds contend for three SEARCH units, replay an existing winning key,
then concurrently create one new shared key and reject another customer's replay.
This tests PostgreSQL capacity/replay, not Stripe webhook or hosted load delivery.
"""
import argparse
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--postgres-bin", required=True)
    parser.add_argument("--evidence-directory", required=True)
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    evidence = Path(args.evidence_directory).resolve(strict=True)
    cluster = (evidence / "cluster").resolve(strict=True)
    if cluster.parent != evidence or cluster.name != "cluster":
        raise RuntimeError("isolated_cluster_boundary_required")
    pid_lines = (cluster / "postmaster.pid").read_text().splitlines()
    if Path(pid_lines[1]).resolve() != cluster or int(pid_lines[3]) != args.port:
        raise RuntimeError("owned_cluster_identity_mismatch")
    if pid_lines[5] != "127.0.0.1":
        raise RuntimeError("loopback_only_cluster_required")
    if not (evidence / "input-hashes.json").is_file():
        raise RuntimeError("native_harness_inputs_required")
    psql = str(Path(args.postgres_bin) / "psql.exe")
    command = [psql, "-X", "-qAt", "-h", "127.0.0.1", "-p", str(args.port),
               "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"]
    env = dict(os.environ)
    env["PGOPTIONS"] = "-c statement_timeout=90000 -c lock_timeout=30000"
    # Explicit local trust; do not inherit a provider connection/password service.
    for key in ("PGPASSWORD", "PGPASSFILE", "PGSERVICE", "PGSERVICEFILE"):
        env.pop(key, None)

    def sql(query):
        result = subprocess.run(command, input=query, text=True, capture_output=True,
                                env=env, timeout=100, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if result.returncode:
            raise RuntimeError(result.stderr.strip())
        return result.stdout.strip()

    sql("""
    do $$ begin
      if exists(select 1 from public.ap_capacity_pools) then
        raise exception 'pressure_requires_empty_synthetic_capacity'; end if;
    end $$;
    create schema ap_pressure_test;
    create table ap_pressure_test.barrier(round integer,phase text,request integer,pid integer,
      primary key(round,phase,request));
    insert into auth.users(id,email,raw_user_meta_data)
      values('f1000000-0000-4000-8000-000000000001','capacity-pressure@example.invalid','{}'),
        ('f1000000-0000-4000-8000-000000000002','capacity-other@example.invalid','{}');
    insert into public.ap_capacity_pools(id,resource,enabled,configuration_version)
      values('f2000000-0000-4000-8000-000000000001','SEARCH',true,'synthetic-pressure-v1');
    insert into public.ap_capacity_buckets(id,pool_id,starts_at,ends_at,total_units,staffing_version)
      values('f3000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001',
        clock_timestamp()-interval '1 hour',clock_timestamp()+interval '2 days',3,'synthetic-pressure-v1');
    create function ap_pressure_test.reserve(request_key text) returns text language plpgsql as $$
    declare allocation uuid;
    begin
      allocation:=public.ap_reserve_capacity('f1000000-0000-4000-8000-000000000001',
        'SEARCH',1,request_key,clock_timestamp()+interval '1 hour');
      return 'OK|'||allocation::text;
    exception when raise_exception then
      if sqlerrm='capacity_unavailable' then return 'FULL'; end if;
      raise;
    end $$;
    """)
    reports = []
    for round_id in range(1, 11):
        def phase(name, keys):
            def worker(index):
                # Each INSERT commits before the barrier waits, proving overlapping sessions.
                return sql(f"""
                insert into ap_pressure_test.barrier values({round_id},'{name}',{index},pg_backend_pid());
                do $$ declare deadline timestamptz:=clock_timestamp()+interval '75 seconds'; begin
                  loop
                    exit when (select count(*) from ap_pressure_test.barrier
                      where round={round_id} and phase='{name}')=20;
                    if clock_timestamp()>deadline then raise exception 'barrier_timeout'; end if;
                    perform pg_sleep(0.01);
                  end loop;
                end $$;
                select ap_pressure_test.reserve('{keys[index]}');
                """)
            with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
                results = list(pool.map(worker, range(20)))
            count = int(sql(f"select count(distinct pid) from ap_pressure_test.barrier where round={round_id} and phase='{name}'"))
            if count != 20:
                raise RuntimeError("independent_backend_count_failed")
            return results

        started = time.monotonic()
        keys = [f"synthetic-pressure-{round_id}-{index}" for index in range(20)]
        results = phase("contend", keys)
        winners = [index for index, result in enumerate(results) if result.startswith("OK|")]
        if len(winners) != 3 or results.count("FULL") != 17:
            raise RuntimeError(f"capacity_limit_failed_round_{round_id}: {results}")
        allocation_ids = {results[index] for index in winners}
        if len(allocation_ids) != 3:
            raise RuntimeError("unique_allocation_count_failed")
        replays = phase("replay", [keys[winners[0]]] * 20)
        if set(replays) != {results[winners[0]]}:
            raise RuntimeError("existing_key_replay_failed")
        held = int(sql("select coalesce(sum(units),0) from public.ap_capacity_allocations where debit_disposition in ('HELD','SPENT')"))
        total = int(sql(f"select count(*) from public.ap_capacity_allocations where request_key like 'synthetic-pressure-{round_id}-%'"))
        if held != 3 or total != 3:
            raise RuntimeError("replay_duplicated_capacity")
        sql("select public.ap_release_unconsumed_capacity(id,'SYNTHETIC_PRESSURE_ROUND_COMPLETE') from public.ap_capacity_allocations where lifecycle='RESERVED'")
        if int(sql("select coalesce(sum(units),0) from public.ap_capacity_allocations where debit_disposition in ('HELD','SPENT')")) != 0:
            raise RuntimeError("release_failed")
        fresh_key = f"synthetic-fresh-shared-{round_id}"
        fresh = phase("fresh-shared-key", [fresh_key] * 20)
        if len(set(fresh)) != 1 or not fresh[0].startswith("OK|"):
            raise RuntimeError(f"first_use_key_replay_failed: {fresh}")
        if int(sql("select coalesce(sum(units),0) from public.ap_capacity_allocations where debit_disposition in ('HELD','SPENT')")) != 1:
            raise RuntimeError("first_use_key_duplicated_capacity")
        sql(f"""
        do $$ begin
          begin
            perform public.ap_reserve_capacity('f1000000-0000-4000-8000-000000000002','SEARCH',1,
              '{fresh_key}',clock_timestamp()+interval '1 hour');
            raise exception 'cross_customer_replay_accepted';
          exception when raise_exception then
            if sqlerrm<>'capacity_idempotency_conflict' then raise; end if;
          end;
          begin
            perform public.ap_reserve_capacity('f1000000-0000-4000-8000-000000000001','MATERIALS',1,
              '{fresh_key}',clock_timestamp()+interval '1 hour');
            raise exception 'cross_resource_replay_accepted';
          exception when raise_exception then
            if sqlerrm<>'capacity_idempotency_conflict' then raise; end if;
          end;
        end $$;
        """)
        sql("select public.ap_release_unconsumed_capacity(id,'SYNTHETIC_FRESH_REPLAY_COMPLETE') from public.ap_capacity_allocations where lifecycle='RESERVED'")
        report = {"round": round_id, "independentConnectionsPerPhase": 20, "accepted": 3,
                  "rejectedAtCapacity": 17, "idempotentReplays": 20, "heldMaximum": held,
                  "firstUseSharedKeyReplays": 20, "crossCustomerReplayDenied": True,
                  "crossResourceReplayDenied": True,
                  "seconds": round(time.monotonic() - started, 3)}
        reports.append(report)
        print(json.dumps(report), flush=True)
    (evidence / "capacity-pressure-result.json").write_text(json.dumps({
        "status": "PASS", "scope": "native PostgreSQL synthetic capacity, first-use and existing-key replay",
        "limitations": ["Not Stripe webhook transport or hosted load proof"],
        "rounds": reports}, indent=2))


if __name__ == "__main__":
    main()
