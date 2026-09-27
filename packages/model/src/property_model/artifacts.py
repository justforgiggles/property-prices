"""Native model persistence and the local handoff to inference and deployment."""
import hashlib
import json
import logging
import shutil
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from catboost import CatBoostRegressor
from lightgbm import Booster

from .config import CATEGORICAL, EXAMPLE, FEATURE_COLUMNS, SEEDS, recipe
from .features import build_reference


@dataclass
class ModelArtifacts:
    """Fitted learners and their reference data; no training or prediction methods."""
    direct: list
    residual: CatBoostRegressor
    categories: dict
    residual_center: float
    reference: dict


def save_model(model, directory, provenance, location_updates=None):
    """Save and reload in a sibling directory, then publish the complete local outputs."""
    directory = Path(directory).resolve()
    if directory.exists() and not (directory / "manifest.json").is_file():
        raise ValueError(f"Refusing to replace a directory that is not a model package: {directory}")
    directory.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f".{directory.name}-", dir=directory.parent) as temporary:
        staging = Path(temporary) / "models"
        staging.mkdir()
        write_model_files(model, staging, provenance)
        verify_roundtrip(model, load_model(staging))
        publish_outputs(staging, directory, location_updates or {})


def load_model(directory):
    """Load trusted native artifacts, accepting either the full or original minimal manifest."""
    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text())
    minimal = set(manifest) == {"format_version", "residual_center"}
    if manifest.get("format_version") != 1:
        raise ValueError("Unsupported model format; train a new model bundle.")
    expected = {f"lightgbm_{seed}.txt" for seed in SEEDS} | {"catboost.cbm", "market.joblib"}
    if not all((directory / name).is_file() for name in expected):
        raise ValueError("Incomplete model package; train a new model bundle.")
    if not minimal:
        if manifest.get("recipe") != recipe():
            raise ValueError("The model package does not match this frozen recipe.")
        if set(manifest.get("files", {})) != expected:
            raise ValueError("Incomplete model manifest.")
        for name, digest in manifest["files"].items():
            if sha256(directory / name) != digest:
                raise ValueError(f"Model file failed its integrity check: {name}")

    state = joblib.load(directory / "market.joblib")
    direct = [Booster(model_file=str(directory / f"lightgbm_{seed}.txt")) for seed in SEEDS]
    residual = CatBoostRegressor()
    residual.load_model(str(directory / "catboost.cbm"))
    if residual.feature_names_ != FEATURE_COLUMNS or any(learner.feature_name() != FEATURE_COLUMNS for learner in direct):
        raise ValueError("Model feature order differs from the feature definition.")
    try:
        model = ModelArtifacts(direct, residual, state["categories"], float(manifest["residual_center"]), state["reference"])
        if not np.isfinite(model.residual_center):
            raise ValueError("Nonfinite residual center")
        if minimal:
            verify_minimal_bundle(model)
    except (KeyError, TypeError, ValueError, AssertionError, AttributeError) as error:
        raise ValueError(f"Incompatible model state; train a new model bundle: {error}") from error
    return model


def write_model_files(model, directory, provenance):
    if len(model.direct) != len(SEEDS):
        raise ValueError("The model requires ten LightGBM learners.")
    for seed, learner in zip(SEEDS, model.direct):
        learner.save_model(str(directory / f"lightgbm_{seed}.txt"))
    model.residual.save_model(str(directory / "catboost.cbm"))
    joblib.dump(dict(reference=model.reference, categories=model.categories), directory / "market.joblib", compress=3)
    manifest = dict(
        format_version=1,
        recipe=recipe(),
        residual_center=model.residual_center,
        provenance=provenance,
        files={path.name: sha256(path) for path in sorted(directory.iterdir())},
    )
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2))


def verify_roundtrip(original, restored):
    from .inference.main import predict

    records = [EXAMPLE, {}, {"province": "unseen", "bedrooms": 0}]
    before = predict(records, original)
    after = predict(records, restored)
    expected = [row["unrounded_prediction_zar"] for row in before]
    actual = [row["unrounded_prediction_zar"] for row in after]
    if not np.isfinite(actual).all() or (np.asarray(actual) <= 0).any():
        raise ValueError("Saved model produced invalid predictions.")
    np.testing.assert_allclose(actual, expected, rtol=1e-12)
    if [row["recommended_asking_price_zar"] for row in before] != [row["recommended_asking_price_zar"] for row in after]:
        raise ValueError("Saved model changed rounded recommendations.")


def verify_minimal_bundle(model):
    """Check legacy state against current feature semantics without fabricating provenance."""
    from .inference.main import predict

    if set(model.categories) != set(CATEGORICAL):
        raise ValueError("Category columns differ")
    levels = []
    for column in CATEGORICAL:
        values = model.categories[column]
        if not isinstance(values, list) or not values or not all(isinstance(value, str) for value in values):
            raise ValueError(f"Invalid categories for {column}")
        if len(values) != len(set(values)):
            raise ValueError(f"Duplicate categories for {column}")
        levels.append(values)
    if any(learner.pandas_categorical != levels for learner in model.direct):
        raise ValueError("LightGBM category encoding differs")
    if model.residual.get_cat_feature_indices() != [FEATURE_COLUMNS.index(column) for column in CATEGORICAL]:
        raise ValueError("CatBoost categorical columns differ")

    reference = model.reference
    rebuilt = build_reference(reference["pool"])
    pd.testing.assert_frame_equal(reference["pool"], rebuilt["pool"])
    np.testing.assert_array_equal(reference["numeric"], rebuilt["numeric"])
    np.testing.assert_array_equal(reference["log_prices"], rebuilt["log_prices"])
    if reference["global_log_price"] != rebuilt["global_log_price"]:
        raise ValueError("Global reference price differs")
    if set(reference["tables"]) != set(rebuilt["tables"]) or set(reference["indices"]) != set(rebuilt["indices"]):
        raise ValueError("Reference groups differ")
    for key, table in rebuilt["tables"].items():
        pd.testing.assert_frame_equal(reference["tables"][key], table)
    for key, groups in rebuilt["indices"].items():
        if set(reference["indices"][key]) != set(groups):
            raise ValueError("Reference membership differs")
        for name, indices in groups.items():
            np.testing.assert_array_equal(reference["indices"][key][name], indices)
    results = predict([EXAMPLE, {}, {"province": "unseen", "bedrooms": 0}], model)
    prices = [row["unrounded_prediction_zar"] for row in results]
    if not np.isfinite(prices).all() or (np.asarray(prices) <= 0).any():
        raise ValueError("Legacy bundle produces invalid predictions")
    logging.warning("Loaded minimal model manifest: native compatibility checked; provenance and checksums unavailable.")


def publish_outputs(staged_model, directory, location_updates):
    """Replace model/catalog/form together, restoring previous paths on a caught failure.

    Single local writer only. This is not crash-atomic across multiple paths.
    Backups survive if rollback itself fails, so recovery remains possible.
    """
    replacements = [(staged_model, directory)]
    prepared_files = []
    backups = []
    try:
        for path, content in location_updates.items():
            path = Path(path)
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                             prefix=f".{path.name}-", delete=False) as stream:
                prepared = Path(stream.name)
                prepared_files.append(prepared)
                stream.write(content)
            prepared.chmod(path.stat().st_mode & 0o777 if path.exists() else 0o644)
            replacements.append((prepared, path))
        try:
            for prepared, destination in replacements:
                backup = None
                if destination.exists():
                    backup = destination.with_name(f".{destination.name}-previous-{uuid.uuid4().hex}")
                    destination.rename(backup)
                backups.append((destination, backup))
                prepared.rename(destination)
        except BaseException:
            for destination, backup in reversed(backups):
                if destination.is_dir():
                    shutil.rmtree(destination)
                elif destination.exists():
                    destination.unlink()
                if backup is not None:
                    backup.rename(destination)
            raise
        for _, backup in backups:
            if backup is not None:
                try:
                    if backup.is_dir():
                        shutil.rmtree(backup)
                    else:
                        backup.unlink()
                except OSError:
                    logging.warning("Outputs published; could not remove backup %s", backup, exc_info=True)
    finally:
        for prepared in prepared_files:
            prepared.unlink(missing_ok=True)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
