"""Form submission → validated inputs → rendered email → Resend delivery."""
import json
import math
import os
import re
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

DIRECTORY = Path(__file__).resolve().parent
LOCATIONS = json.loads((DIRECTORY / "locations.json").read_text())
TEMPLATES = Environment(
    loader=FileSystemLoader(DIRECTORY / "email"),
    autoescape=select_autoescape(["html"]),
    undefined=StrictUndefined,
    keep_trailing_newline=True,
)


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


def render_email(submission: dict, estimate: dict) -> dict:
    """Display the model's rounded recommendation directly; escape HTML, not plain text."""
    property_ = submission["property"]
    price = estimate["recommended_asking_price_zar"]
    if not math.isfinite(price) or price < 0 or price % 1000:
        raise ValueError("Model returned an invalid rounded asking price")
    values = dict(
        greeting=f"Hi {submission['first_name']}," if submission["first_name"] else "Hello,",
        headline="Your recommended asking price",
        intro="Based on the details you shared, your property's recommended asking price is:",
        primaryLabel="Recommended asking price",
        primaryValue="R\u00a0" + f"{price:,.0f}".replace(",", "\u00a0"),
        estimateNote="This is an automated asking-price estimate based on advertised listings, not a formal valuation or a prediction of the final sale price.",
        location=", ".join(property_[key] for key in ("suburb", "city", "province")),
        bedrooms=property_["bedrooms"],
        bathrooms=property_["bathrooms"],
        size=f"{property_['floor_size']:,}".replace(",", "\u00a0") + " m²",
    )
    return dict(
        to=[submission["email"]],
        subject="Your South African property value estimate",
        html=TEMPLATES.get_template("property-valuation.html").render(values),
        text=TEMPLATES.get_template("property-valuation.txt").render(values),
    )


def send_email(identifier: str, email: dict) -> None:
    """Resend deduplicates retries using the original submission ID."""
    api_key = os.environ.get("RESEND_API_KEY")
    sender = os.environ.get("RESEND_FROM_EMAIL")
    if not api_key or not sender:
        raise RuntimeError("Resend is not configured")
    request = Request(
        "https://api.resend.com/emails",
        data=json.dumps({**email, "from": sender}).encode(),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json",
                 "Idempotency-Key": f"property-valuation/{identifier}"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=30) as response:
            if not 200 <= response.status < 300:
                raise RuntimeError(f"Resend rejected the email with status {response.status}")
    except HTTPError as error:
        error.close()
        raise RuntimeError(f"Resend rejected the email with status {error.code}") from error
