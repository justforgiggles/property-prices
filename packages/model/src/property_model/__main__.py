from __future__ import annotations

import sys
from pathlib import Path

from .train import train


if __name__ == "__main__":
    if sys.argv[1:] != ["train"]:
        raise SystemExit("Usage: python -m property_model train")
    try:
        train(Path(__file__).resolve().parents[2])
    except (FileNotFoundError, RuntimeError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1) from error
