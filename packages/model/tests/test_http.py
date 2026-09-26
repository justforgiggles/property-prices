"""Webhook contract, presentation, delivery, and cache checks; no real email is sent."""
import copy
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main as http
import valuation as email_helpers

SUBMISSION = {
    "id": " submission-123 ", "status": "completed", "metadata": {"source": "form"},
    "data": {"province": "Western Cape", "city": "Cape Town", "suburb": "Sea Point",
             "bedrooms": "3", "bathrooms": " 2 ", "floor_area": " 120 ", "rates_and_taxes": "1800",
             "email": " thandi@example.com ", "first_name": " Thandi <Test> "},
}
PROPERTY = dict(province="Western Cape", city="Cape Town", suburb="Sea Point", bedrooms=3,
                bathrooms=2, floor_size=120, rates=1800)
ESTIMATE = {"recommended_asking_price_zar": 1250000}


class HttpTests(unittest.TestCase):
    def request(self, body=SUBMISSION, method="POST"):
        request = Mock(method=method)
        request.get_json.return_value = body
        return request

    def test_invalid_submissions_never_predict_or_send(self):
        invalid = [None, [], {}, {**SUBMISSION, "status": "partial"},
                   {**SUBMISSION, "id": "\r\ninjected"}, {**SUBMISSION, "id": 1},
                   {**SUBMISSION, "data": None}, {**SUBMISSION, "data": []}]
        for field, value in [("province", "Eastern Cape"), ("city", "Durban"), ("suburb", ""),
                             ("bedrooms", True), ("bedrooms", "1.5"), ("bathrooms", 1.5),
                             ("bedrooms", "1e1"), ("bedrooms", "２"), ("bedrooms", []),
                             ("rates_and_taxes", "0"), ("rates_and_taxes", "100001"),
                             ("rates_and_taxes", float("nan")), ("floor_area", float("inf")),
                             ("floor_area", 5001), ("floor_area", "9"),
                             ("email", "not-an-email"), ("first_name", "  "), ("first_name", None)]:
            invalid.append({**SUBMISSION, "data": {**SUBMISSION["data"], field: value}})
        for field in PROPERTY.keys() - {"floor_size", "rates"} | {"floor_area", "rates_and_taxes", "email"}:
            data = {key: value for key, value in SUBMISSION["data"].items() if key != field}
            invalid.append({**SUBMISSION, "data": data})
        with patch.object(http, "get_model") as model, patch.object(http, "send_email") as send:
            for body in invalid:
                with self.subTest(body=body):
                    self.assertEqual(http.valuation(self.request(body))[1], 400)
            result = http.valuation(self.request(method="GET"))
            self.assertEqual(result[1], 405)
            self.assertEqual(result[2]["Allow"], "POST")
            model.assert_not_called()
            send.assert_not_called()

    def test_location_matching_and_optional_name(self):
        for province, city, suburb in [("Gauteng", "Heidelberg", "Rensburg"),
                                      ("Western Cape", "Heidelberg", "Heidelberg"),
                                      ("Western Cape", "Brackenfell", "Arauna")]:
            body = copy.deepcopy(SUBMISSION)
            body["data"].update(province=province, city=city, suburb=suburb, bedrooms=3.0)
            body["data"].pop("first_name")
            parsed = email_helpers.parse_submission(body)
            self.assertEqual(parsed["first_name"], "")
            self.assertEqual(parsed["property"]["bedrooms"], 3)
        body["data"].update(province="Gauteng", city="Heidelberg", suburb="Heidelberg")
        with self.assertRaises(ValueError):
            email_helpers.parse_submission(body)

    def test_success_maps_fields_escapes_html_and_preserves_input(self):
        original = copy.deepcopy(SUBMISSION)
        with patch.object(http, "get_model") as loader, patch.object(http, "send_email") as send:
            loader.return_value.predict.return_value = [ESTIMATE]
            result = http.valuation(self.request())
            self.assertEqual(result[1], 204)
            self.assertEqual(result[2]["Cache-Control"], "no-store")
            loader.return_value.predict.assert_called_once_with(PROPERTY)
            identifier, email = send.call_args.args
            self.assertEqual(identifier, "submission-123")
            self.assertEqual(email["to"], ["thandi@example.com"])
            self.assertIn("Hi Thandi &lt;Test&gt;,", email["html"])
            self.assertIn("Hi Thandi <Test>,", email["text"])
            self.assertIn("R\u00a01\u00a0250\u00a0000", email["text"])
            self.assertIn("Floor area: 120 m²", email["text"])
            self.assertNotIn("{{", email["html"])
            self.assertNotIn("{{", email["text"])
            self.assertNotIn("likely range", email["html"])
        self.assertEqual(SUBMISSION, original)

    def test_model_failure_prevents_email_and_delivery_failures_return_502(self):
        with patch.object(http, "get_model", side_effect=OSError("bad artifact")), patch.object(http, "send_email") as send:
            with self.assertLogs(level="ERROR"):
                self.assertEqual(http.valuation(self.request())[1], 500)
            send.assert_not_called()
        with patch.object(http, "get_model") as model, patch.object(http, "send_email", side_effect=TimeoutError):
            model.return_value.predict.return_value = [ESTIMATE]
            with self.assertLogs(level="ERROR"):
                self.assertEqual(http.valuation(self.request())[1], 502)

    def test_resend_payload_timeout_and_idempotency(self):
        parsed = email_helpers.parse_submission(SUBMISSION)
        email = email_helpers.render_email(parsed, ESTIMATE)
        with patch.dict(os.environ, RESEND_API_KEY="test-key", RESEND_FROM_EMAIL="Peter <hello@frms.dev>"), patch.object(email_helpers, "urlopen") as open_url:
            open_url.return_value.__enter__.return_value.status = 200
            for _ in range(2):
                email_helpers.send_email(parsed["id"], email)
            for call in open_url.call_args_list:
                request = call.args[0]
                self.assertEqual(request.full_url, "https://api.resend.com/emails")
                self.assertEqual(request.method, "POST")
                self.assertEqual(request.get_header("Idempotency-key"), "property-valuation/submission-123")
                self.assertEqual(request.get_header("Authorization"), "Bearer test-key")
                self.assertEqual(call.kwargs["timeout"], 30)
                self.assertEqual(json.loads(request.data), {**email, "from": "Peter <hello@frms.dev>"})
            for failure in [HTTPError("https://api.resend.com/emails", 429, "rate limit", {}, None), TimeoutError()]:
                open_url.side_effect = failure
                with self.assertRaises((RuntimeError, TimeoutError)):
                    email_helpers.send_email(parsed["id"], email)
        with patch.dict(os.environ, {}, clear=True), patch.object(email_helpers, "urlopen") as open_url:
            with self.assertRaisesRegex(RuntimeError, "not configured"):
                email_helpers.send_email(parsed["id"], email)
            open_url.assert_not_called()

    def test_model_is_cached_across_requests(self):
        http.get_model.cache_clear()
        try:
            with patch.object(http, "load_model") as load, patch.object(http, "send_email"):
                load.return_value.predict.return_value = [ESTIMATE]
                for _ in range(2):
                    self.assertEqual(http.valuation(self.request())[1], 204)
                load.assert_called_once()
                self.assertEqual(load.return_value.predict.call_count, 2)
        finally:
            http.get_model.cache_clear()
