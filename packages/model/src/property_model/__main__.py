from __future__ import annotations

import sys
from pathlib import Path

from .locations import sync_locations
from .train import train


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["train"]:
            train(Path(__file__).resolve().parents[2])
        elif sys.argv[1:] in (["sync-locations"], ["sync-locations", "--check"]):
            sync_locations(
                Path(__file__).resolve().parents[4],
                check="--check" in sys.argv[1:],
            )
        else:
            raise SystemExit("Usage: python -m property_model {train|sync-locations [--check]}")
    except (FileNotFoundError, RuntimeError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1) from error
