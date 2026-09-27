"""One HTTP pipeline: validate submission → predict locally → render → send email."""
import json
import logging

import re
from pathlib import Path

from property_model.inference.main import get_model, predict
from property_model.http.delivery import render_email, send_email

PACKAGE = Path(__file__).resolve().parents[3]
LOCATIONS = json.loads((PACKAGE / "locations.json").read_text())


def valuation(request):
    headers = {"Cache-Control": "no-store", "Content-Type": "application/json"}
    if request.method != "POST":
        return json.dumps({"error": "Method not allowed"}), 405, {**headers, "Allow": "POST"}
    try:
        submission = parse_submission(request.get_json(silent=True))
    except ValueError:
        return json.dumps({"error": "Submission is invalid"}), 400, headers
    try:
        estimate = predict(submission["property"], get_model(PACKAGE / "models"))[0]
    except Exception:
        logging.exception("Property valuation failed")
        return json.dumps({"error": "Valuation failed"}), 500, headers
    try:
        email = render_email(submission, estimate, PACKAGE / "email")
        send_email(submission["id"], email)
    except Exception:
        logging.exception("Valuation email delivery failed")
        return json.dumps({"error": "Email delivery failed"}), 502, headers
    return "", 204, headers


def parse_submission(body: object) -> dict:
    """Keep form validation separate from the model's more permissive input contract."""
    if not isinstance(body, dict) or body.get("status") != "completed" or not isinstance(body.get("data"), dict):
        raise ValueError("Submission is invalid")
    identifier = body.get("id")
    if not isinstance(identifier, str) or not 1 <= len(identifier.strip()) <= 200 or re.search(r"[\r\n]", identifier):
        raise ValueError("Submission ID is invalid")
    data = {key: value.strip() if isinstance(value, str) else value for key, value in body["data"].items()}
    first_name = body["data"].get("first_name", "")
    if not isinstance(first_name, str) or (first_name and not first_name.strip()) or len(first_name.strip()) > 80:
        raise ValueError("First name is invalid")
    email = data.get("email")
    if not isinstance(email, str) or len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise ValueError("Email is invalid")
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
    return dict(id=identifier.strip(), email=email, first_name=first_name.strip(), property=property_)
