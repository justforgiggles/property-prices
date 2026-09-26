"""Inference entry point: saved model + homeowner inputs → price and diagnostics."""
import argparse
import json
from pathlib import Path

from .artifacts import load_model
from .config import EXAMPLE, PACKAGE


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", default=PACKAGE / "models")
    parser.add_argument("--input", help="Property JSON, batch JSON, or a JSON file; defaults to the documented example.")
    args = parser.parse_args()
    try:
        records = EXAMPLE
        if args.input is not None:
            raw = args.input if args.input.lstrip().startswith(("{", "[")) else Path(args.input).read_text()
            records = json.loads(raw)
        print(json.dumps(load_model(args.model_dir).predict(records), indent=2, allow_nan=False))
    except (OSError, ValueError, TypeError) as error:
        parser.exit(1, f"Prediction failed: {error}\n")


if __name__ == "__main__":
    main()
