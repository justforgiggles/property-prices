"""One HTTP pipeline: validate submission → predict locally → render → send email."""
import json
import logging
from functools import lru_cache
from pathlib import Path

from property_model.artifacts import load_model
from valuation import parse_submission, render_email, send_email


@lru_cache(maxsize=1)
def get_model():
    return load_model(Path(__file__).resolve().parent / "models")


def valuation(request):
    headers = {"Cache-Control": "no-store", "Content-Type": "application/json"}
    if request.method != "POST":
        return json.dumps({"error": "Method not allowed"}), 405, {**headers, "Allow": "POST"}
    try:
        submission = parse_submission(request.get_json(silent=True))
    except ValueError:
        return json.dumps({"error": "Submission is invalid"}), 400, headers
    try:
        estimate = get_model().predict(submission["property"])[0]
    except Exception:
        logging.exception("Property valuation failed")
        return json.dumps({"error": "Valuation failed"}), 500, headers
    try:
        email = render_email(submission, estimate)
        send_email(submission["id"], email)
    except Exception:
        logging.exception("Valuation email delivery failed")
        return json.dumps({"error": "Email delivery failed"}), 502, headers
    return "", 204, headers
