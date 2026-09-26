"""Native model files plus a checked manifest and plain historical reference data."""
import hashlib
import importlib.metadata
import json
import platform
import shutil
import tempfile
import uuid
from pathlib import Path

import joblib
import numpy as np
from catboost import CatBoostRegressor
from lightgbm import Booster

from .config import EXAMPLE, FEATURE_COLUMNS, PACKAGE, SEEDS, recipe
from .modeling import AskingPriceModel


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def save_model(model, directory, provenance):
    """Build completely in a sibling directory before replacing a working package."""
    directory = Path(directory).resolve()
    legacy_files = {"encoders.json", "model.onnx", "model_confidence.onnx", "model_q10.onnx", "model_q90.onnx"}
    if directory.exists() and not (directory / "manifest.json").is_file():
        if {path.name for path in directory.iterdir()} != legacy_files:
            raise ValueError(f"Refusing to replace a directory that is not a model package: {directory}")
    directory.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{directory.name}-", dir=directory.parent))
    previous = directory.with_name(f".{directory.name}-previous-{uuid.uuid4().hex}")
    try:
        if len(model.direct) != len(SEEDS):
            raise ValueError("The final package requires ten LightGBM learners.")
        for seed, learner in zip(SEEDS, model.direct):
            learner.save_model(str(staging / f"lightgbm_{seed}.txt"))
        model.residual.save_model(str(staging / "catboost.cbm"))
        joblib.dump(dict(reference=model.reference, categories=model.categories), staging / "market.joblib", compress=3)
        manifest = dict(
            format_version=1, recipe=recipe(), residual_center=model.residual_center,
            provenance=provenance, python=platform.python_version(),
            packages={name: importlib.metadata.version(name) for name in
                      ["numpy", "pandas", "scikit-learn", "lightgbm", "catboost", "joblib", "scipy"]},
            source_hashes={str(path.relative_to(PACKAGE)): sha256(path) for path in sorted((PACKAGE / "src").rglob("*.py"))},
            files={path.name: sha256(path) for path in sorted(staging.iterdir())},
        )
        (staging / "manifest.json").write_text(json.dumps(manifest, indent=2))
        # A package must reload successfully before it can replace the previous version.
        restored = load_model(staging)
        records = [EXAMPLE, {}, {"province": "unseen", "bedrooms": 0}]
        before, after = model.predict(records), restored.predict(records)
        expected = [row["unrounded_prediction_zar"] for row in before]
        actual = [row["unrounded_prediction_zar"] for row in after]
        if not np.isfinite(actual).all():
            raise ValueError("Saved model produced nonfinite predictions.")
        np.testing.assert_allclose(actual, expected, rtol=1e-12)
        if [row["recommended_asking_price_zar"] for row in before] != [row["recommended_asking_price_zar"] for row in after]:
            raise ValueError("Saved model changed rounded recommendations.")
        if directory.exists():
            directory.rename(previous)
        try:
            staging.rename(directory)
        except BaseException:
            if previous.exists():
                previous.rename(directory)
            raise
        if previous.exists():
            shutil.rmtree(previous)
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def load_model(directory):
    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text())
    if manifest["format_version"] != 1 or manifest["recipe"] != recipe():
        raise ValueError("The model package does not match this frozen recipe.")
    expected = {f"lightgbm_{seed}.txt" for seed in SEEDS} | {"catboost.cbm", "market.joblib"}
    if set(manifest["files"]) != expected:
        raise ValueError("Incomplete model package.")
    for name, digest in manifest["files"].items():
        if sha256(directory / name) != digest:
            raise ValueError(f"Model file failed its integrity check: {name}")
    state = joblib.load(directory / "market.joblib")
    direct = [Booster(model_file=str(directory / f"lightgbm_{seed}.txt")) for seed in SEEDS]
    residual = CatBoostRegressor()
    residual.load_model(str(directory / "catboost.cbm"))
    if residual.feature_names_ != FEATURE_COLUMNS or any(learner.feature_name() != FEATURE_COLUMNS for learner in direct):
        raise ValueError("Model feature order differs from the final feature definition.")
    return AskingPriceModel(direct, residual, state["categories"], manifest["residual_center"], state["reference"])


if __name__ == "__main__":
    import sys
    model = load_model(sys.argv[1] if len(sys.argv) > 1 else PACKAGE / "models")
    print(json.dumps(model.predict([EXAMPLE, {}]), indent=2, allow_nan=False))
