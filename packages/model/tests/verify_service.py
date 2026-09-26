"""Real local webhook → native model → email parity check, with Resend transport mocked."""
import json
import os
from pathlib import Path
import sys
from threading import Thread
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import functions_framework
from werkzeug.serving import make_server

from property_model.artifacts import load_model
from property_model.config import EXAMPLE, PACKAGE

sys.path.insert(0, str(PACKAGE))


def main():
    app = functions_framework.create_app("valuation", str(PACKAGE / "main.py"))
    server = make_server("127.0.0.1", 0, app)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    endpoint = f"http://127.0.0.1:{server.server_port}"
    records = [EXAMPLE, dict(province="Western Cape", city="Cape Town", suburb="Sea Point",
                            bedrooms=3, bathrooms=2, floor_size=120, rates=1800)]
    try:
        model = load_model(PACKAGE / "models")
        with patch.dict(os.environ, RESEND_API_KEY="test-only", RESEND_FROM_EMAIL="test@example.com"), patch("valuation.urlopen") as resend:
            resend.return_value.__enter__.return_value.status = 200
            for index, record in enumerate(records):
                body = dict(id=f"local-{index}", status="completed", data={
                    **{key: record[key] for key in ("province", "city", "suburb", "bedrooms", "bathrooms")},
                    "floor_area": record["floor_size"], "rates_and_taxes": record["rates"],
                    "email": "test@example.com", "first_name": "<Test>",
                })
                request = Request(endpoint, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
                with urlopen(request, timeout=30) as response:
                    assert response.status == 204
                    assert response.headers["Cache-Control"] == "no-store"
                email_request = resend.call_args.args[0]
                email = json.loads(email_request.data)
                price = model.predict(record)[0]["recommended_asking_price_zar"]
                display = "R\u00a0" + f"{price:,.0f}".replace(",", "\u00a0")
                assert display in email["text"] and display in email["html"]
                assert "Hi &lt;Test&gt;," in email["html"]
                assert email_request.get_header("Idempotency-key") == f"property-valuation/local-{index}"
            for request, status in [(endpoint, 405), (Request(endpoint, data=b"{}", headers={"Content-Type": "application/json"}), 400)]:
                try:
                    urlopen(request, timeout=5)
                except HTTPError as error:
                    assert error.code == status
                else:
                    raise AssertionError("Invalid request succeeded")
            assert resend.call_count == len(records)
        print(json.dumps(dict(properties_checked=len(records), webhook_price_parity=True,
                              email_rendering_verified=True, real_email_sent=False)))
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()


if __name__ == "__main__":
    main()
