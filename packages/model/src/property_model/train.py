"""Raw listings → grouped features → evaluation → production model package."""
import argparse
import json
import sys
from pathlib import Path

from sklearn.model_selection import GroupShuffleSplit

from .artifacts import load_model, save_model, sha256
from .config import PACKAGE, ROOT
from .data import load_data, split_data
from .evaluation import evaluate_model
from .modeling import fit_model


def reserve_test(data, audit, path):
    """Freeze group membership once; changed raw data needs an explicit new split path."""
    path = Path(path)
    if path.exists():
        membership = json.loads(path.read_text())
        if membership.get("raw_sha256") != audit["raw_sha256"]:
            raise ValueError("Raw data changed; provide a new --splits path for a new evaluation population.")
    else:
        splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=20260925)
        development, test = next(splitter.split(data, groups=data.group))
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("x") as stream:
            json.dump(dict(raw_sha256=audit["raw_sha256"], seed=20260925,
                           development=data.iloc[development].id.tolist(),
                           test=data.iloc[test].id.tolist()), stream, indent=2)
    return split_data(data, path)


def provenance(data, audit, population, splits):
    return dict(data_audit=audit, population=population,
                training_rows=len(data), training_groups=int(data.group.nunique()),
                training_ids=data.id.tolist(), split_sha256=sha256(splits))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data/raw")
    parser.add_argument("--output-dir", type=Path, default=PACKAGE / "models")
    parser.add_argument("--build-dir", type=Path, default=PACKAGE / "build")
    parser.add_argument("--splits", type=Path, default=ROOT / "data/splits.json")
    args = parser.parse_args(argv)

    data, audit = load_data(args.data_dir)
    development, test = reserve_test(data, audit, args.splits)
    args.build_dir.mkdir(parents=True, exist_ok=True)
    (args.build_dir / "data-quality.json").write_text(json.dumps(audit, indent=2))
    print(f"Cleaned {len(data):,} listings; development {len(development):,}, test {len(test):,}",
          file=sys.stderr, flush=True)

    evaluation_directory = args.build_dir / "evaluation"
    expected = provenance(development, audit, "development", args.splits)
    manifest_path = evaluation_directory / "manifest.json"
    if manifest_path.exists() and json.loads(manifest_path.read_text())["provenance"] == expected:
        development_model = load_model(evaluation_directory)
    else:
        development_model = fit_model(development)
        save_model(development_model, evaluation_directory, expected)
    report = evaluate_model(development_model, development, test, args.build_dir / "reports")
    print(json.dumps(report, indent=2), flush=True)
    del development_model

    production = fit_model(data)
    metadata = provenance(data, audit, "all_valid", args.splits)
    metadata["evaluation"] = report
    save_model(production, args.output_dir, metadata)
    print(f"Verified production package: {args.output_dir}", flush=True)
