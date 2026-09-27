"""Form submission → validated inputs → rendered email → Resend delivery."""
import json
import math
import os
from functools import lru_cache

from property_model.config import PACKAGE
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

def render_email(submission: dict, estimate: dict, template_directory=PACKAGE / "email") -> dict:
    """Display the model's rounded recommendation directly; escape HTML, not plain text."""
    templates = email_templates(template_directory)
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
        html=templates.get_template("property-valuation.html").render(values),
        text=templates.get_template("property-valuation.txt").render(values),
    )


def send_email(identifier: str, email: dict) -> None:
    """Resend deduplicates retries using the original submission ID."""
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
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


@lru_cache(maxsize=1)
def email_templates(directory):
    return Environment(
        loader=FileSystemLoader(directory),
        autoescape=select_autoescape(["html"]),
        undefined=StrictUndefined,
        keep_trailing_newline=True,
    )
