"""One-off replication check: python tests/verify_reference.py /path/to/demo."""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from property_model.artifacts import load_model
from property_model.data import load_data
from property_model.features import prediction_features, training_features


def main():
    demo = Path(sys.argv[1]).resolve()
    sys.path.insert(0, str(demo))
    from src.data import load_data as original_load
    from src.features import prediction_features as original_features
    from src.features import training_features as original_training_features
    from src.artifacts import load_model as original_model

    data, audit = load_data(demo / "data/raw")
    original, original_audit = original_load(demo / "data/raw")
    pd.testing.assert_frame_equal(data, original)
    assert audit == original_audit
    model = load_model(demo / "artifacts/final")
    reference = pd.read_csv(demo / "reports/final/final_migration_reference.csv", dtype={"id": str})
    query = data.set_index("id").loc[reference.id].reset_index()
    pd.testing.assert_frame_equal(prediction_features(query, model.reference),
                                  original_features(query, model.reference))
    sample = data.iloc[:200].reset_index(drop=True)
    pd.testing.assert_frame_equal(training_features(sample), original_training_features(sample))
    actual = model.predict_frame(query)
    np.testing.assert_allclose(actual, reference.prediction, rtol=1e-9, atol=1e-8)
    np.testing.assert_array_equal(np.round(actual, -3), np.round(reference.prediction, -3))
    records = [{}, {"province": "unknown", "bedrooms": 0},
               {"province": "Gauteng", "city": "Johannesburg", "suburb": "Berea",
                "bedrooms": 2, "bathrooms": 1, "floor_size": 85, "rates": 700}]
    assert model.predict(records) == original_model(demo / "artifacts/final").predict(records)
    report = dict(rows=len(query), raw_sha256=audit["raw_sha256"],
                  max_absolute_difference=float(np.max(abs(actual - reference.prediction))),
                  rounded_predictions_identical=True, features_identical=True)
    output = Path(__file__).resolve().parents[1] / "build"
    output.mkdir(exist_ok=True)
    (output / "replication.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
