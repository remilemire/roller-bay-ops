"""Run all inventory profiles three times. Write one JSON record per run to stdout."""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path


def process_memory(planner_pid):
    rows = subprocess.check_output(["ps", "-axo", "pid=,ppid=,rss="], text=True)
    children = {}
    rss = {}
    for row in rows.splitlines():
        pid, parent, kib = map(int, row.split())
        rss[pid] = kib / 1024
        children.setdefault(parent, []).append(pid)
    if planner_pid not in rss:
        return None
    pending = list(children.get(planner_pid, []))
    solver = 0.0
    while pending:
        child = pending.pop()
        solver += rss[child]
        pending.extend(children.get(child, []))
    planner = rss[planner_pid]
    return time.time() * 1000, planner, solver, planner + solver


def measure(runner, inventory, count, profile, mode):
    args = ["node", str(runner), str(inventory), str(count), profile, mode]
    with subprocess.Popen(args, stdout=subprocess.PIPE, text=True) as process:
        samples = []
        while process.poll() is None:
            sample = process_memory(process.pid)
            if sample:
                samples.append(sample)
            time.sleep(0.035)
        output, _ = process.communicate()
        if process.returncode:
            raise subprocess.CalledProcessError(process.returncode, args, output)
    record = json.loads(output)
    during = [s for s in samples if record["start"] <= s[0] <= record["end"]]
    if during:
        for index, key in enumerate(("plannerMiB", "solverMiB", "combinedMiB"), 1):
            record[key] = max(s[index] for s in during)
        record["samples"] = len(during)
    elif mode == "refine":
        raise RuntimeError("No memory samples during refinement")
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inventory", type=Path)
    args = parser.parse_args()
    runner = Path(__file__).with_name("benchmark-cutting.mjs")
    for rep, counts in enumerate(((128, 256, 512), (256, 512, 128), (512, 128, 256))):
        for count in counts:
            for profile in ("repeated", "mixed", "fragmented"):
                for mode in ("first", "refine"):
                    record = measure(runner, args.inventory, count, profile, mode)
                    print(json.dumps({**record, "rep": rep}), flush=True)
                    print(
                        f"{count} {profile} {mode}: {record['elapsedMs']:.1f} ms",
                        file=sys.stderr,
                    )


if __name__ == "__main__":
    main()
