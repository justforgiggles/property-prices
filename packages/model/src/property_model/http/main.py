"""Predict from a partial form submission and save the result to frms.dev."""
import json
import logging
import math
import re
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from property_model.inference.main import get_model, predict

PACKAGE = Path(__file__).resolve().parents[3]
LOCATIONS = json.loads((PACKAGE / "locations.json").read_text())
FORM_ID = "ad3e54459"
SUBMISSIONS_URL = f"https://frms.dev/api/v1/forms/{FORM_ID}/submissions"


def valuation(request):
    headers = {"Cache-Control": "no-store", "Content-Type": "application/json"}
    if request.method != "POST":
        return json.dumps({"error": "Method not allowed"}), 405, {**headers, "Allow": "POST"}
    body = request.get_json(silent=True)
    if isinstance(body, dict) and (body.get("status") != "partial" or body.get("section_id") != "property"):
        return "", 204, headers
    try:
        submission = parse_submission(body)
    except ValueError:
        return json.dumps({"error": "Submission is invalid"}), 400, headers
    try:
        estimate = predict(submission["property"], get_model(PACKAGE / "models"))[0]
    except Exception:
        logging.exception("Property valuation failed")
        return json.dumps({"error": "Valuation failed"}), 500, headers
    try:
        save_prediction(submission["id"], estimate)
    except Exception:
        logging.exception("Saving property valuation failed")
        return json.dumps({"error": "Saving valuation failed"}), 502, headers
    return "", 204, headers


def parse_submission(body: object) -> dict:
    """Keep form validation separate from the model's more permissive input contract."""
    if (not isinstance(body, dict) or body.get("status") != "partial" or body.get("section_id") != "property"
            or body.get("form_id") != FORM_ID or not isinstance(body.get("data"), dict)):
        raise ValueError("Submission is invalid")
    identifier = body.get("id")
    if not isinstance(identifier, str) or not re.fullmatch(r"[a-f0-9]{32}", identifier):
        raise ValueError("Submission ID is invalid")
    data = {key: value.strip() if isinstance(value, str) else value for key, value in body["data"].items()}
    property_ = {}
    for field in ("province", "city", "suburb"):
        value = data.get(field)
        if not isinstance(value, str) or not 1 <= len(value) <= 100:
            raise ValueError("Location is invalid")
        property_[field] = value
    if property_["suburb"] not in LOCATIONS.get(property_["province"], {}).get(property_["city"], []):
        raise ValueError("Location is invalid")
    for source, target, minimum, maximum in (
        ("bedrooms", "bedrooms", 1, 20),
        ("bathrooms", "bathrooms", 1, 20),
        ("floor_area", "floor_size", 10, 5000),
        ("rates_and_taxes", "rates", 1, 100000),
    ):
        value = data.get(source)
        if isinstance(value, str) and re.fullmatch(r"[0-9]+", value):
            value = int(value)
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or not minimum <= value <= maximum or value != int(value)):
            raise ValueError(f"{source} is invalid")
        property_[target] = int(value)
    return dict(id=identifier, property=property_)


def save_prediction(identifier: str, estimate: dict) -> None:
    price = estimate["recommended_asking_price_zar"]
    if not isinstance(price, (int, float)) or not math.isfinite(price) or price <= 0 or price % 1000:
        raise ValueError("Model returned an invalid rounded asking price")
    prediction = {**estimate, "formatted_asking_price": "R\u00a0" + f"{price:,.0f}".replace(",", "\u00a0")}
    request = Request(
        f"{SUBMISSIONS_URL}?{urlencode({'id': identifier, 'partial': 'true'})}",
        data=json.dumps({"prediction": prediction}, allow_nan=False).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "property-prices/1.0"},
        method="POST",
    )
    with urlopen(request, timeout=10) as response:
        if not 200 <= response.status < 300:
            raise RuntimeError(f"frms.dev rejected the prediction with status {response.status}")
