"""Run training, prediction, evaluation, or location synchronization."""
import sys
from pathlib import Path


def main():
    command = sys.argv.pop(1) if len(sys.argv) > 1 else ""
    if command == "train":
        from .train import main as train
        train()
    elif command == "predict":
        from .inference import main as predict
        predict()
    elif command == "evaluate":
        from .evaluation import main as evaluate
        evaluate()
    elif command == "sync-locations" and sys.argv[1:] in ([], ["--check"]):
        from .locations import sync_locations
        sync_locations(Path(__file__).resolve().parents[4], check="--check" in sys.argv)
    else:
        raise ValueError("Usage: python -m property_model {train|predict|evaluate|sync-locations} [options]")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1) from error
