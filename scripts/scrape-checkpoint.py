"""Publish complete JSONL records from an append-only scraper checkout."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


def publish(final=False):
    git("fetch", "origin", "main")
    if git("diff", "HEAD..origin/main", "--name-only", "--", "data/raw"):
        raise RuntimeError("Another writer changed raw data; stopping to avoid overwriting it")
    git("rebase", "origin/main")
    source = Path(os.environ.get("SCRAPE_RAW_DIRECTORY", "data/raw"))
    for path in source.glob("*.jsonl"):
        content = path.read_bytes()
        if not content.endswith(b"\n"):
            if final or source.resolve() == Path("data/raw").resolve():
                raise ValueError(f"Incomplete raw record in {path}")
            content = content[:content.rfind(b"\n") + 1]
        for line in content.splitlines():
            record = json.loads(line)
            if type(record.get("id")) is not int or not isinstance(record.get("jsonld"), list):
                raise ValueError(f"Invalid raw record in {path}")
        if source.resolve() != Path("data/raw").resolve():
            target = Path("data/raw") / path.name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
    if final:
        Path("data/scrape-completed.json").write_text(json.dumps({
            "run_id": os.environ["SCRAPE_RUN_ID"],
            "droplet_id": int(os.environ["SCRAPE_DROPLET_ID"]),
            "completed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }, indent=2) + "\n")
    git("add", "--", "data/raw")
    if final:
        git("add", "--", "data/scrape-completed.json")
    if git("diff", "--cached", "--name-only"):
        git("commit", "-m", "Scrape completed" if final else "Scrape checkpoint [skip ci]")
    git("fetch", "origin", "main")
    git("rebase", "origin/main")
    git("push", "origin", "HEAD:main")


if __name__ == "__main__":
    publish(sys.argv[1] == "complete")
