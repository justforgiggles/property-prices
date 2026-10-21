"""Check the partial webhook and frms.dev update without network calls."""
import json
import unittest
from unittest.mock import MagicMock, Mock, patch

from property_model.http.main import valuation


class ValuationWebhookTests(unittest.TestCase):
    def setUp(self):
        self.body = {
            "id": "a" * 32,
            "form_id": "ad3e54459",
            "status": "partial",
            "section_id": "property",
            "data": {
                "province": "Gauteng",
                "city": "Johannesburg",
                "suburb": "Berea",
                "bedrooms": "2",
                "bathrooms": "1",
                "floor_area": "85",
                "rates_and_taxes": "700",
            },
        }

    def test_health_checks_model_without_updating_submissions(self):
        with (patch("property_model.http.main.get_model", return_value=object()),
              patch("property_model.http.main.predict", return_value=[{"recommended_asking_price_zar": 1000000}]),
              patch("pathlib.Path.read_bytes", return_value=b"manifest"),
              patch("property_model.http.main.urlopen") as urlopen):
            body, status, headers = valuation(Mock(method="GET", path="/healthz"))
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)["status"], "ok")
            self.assertEqual(headers["Cache-Control"], "no-store")
            urlopen.assert_not_called()

    def test_broken_model_is_unhealthy(self):
        with (patch("property_model.http.main.get_model", side_effect=ValueError("bad artifact")),
              patch("property_model.http.main.urlopen") as urlopen):
            self.assertEqual(valuation(Mock(method="GET", path="/healthz"))[1], 503)
            urlopen.assert_not_called()

    def test_property_save_predicts_and_updates_same_submission(self):
        for form_id in ("ad3e54459", "a01234567", "abcdef012"):
            with self.subTest(form_id=form_id):
                body = {**self.body, "form_id": form_id}
                response = MagicMock(status=200)
                response.__enter__.return_value = response
                with (patch("property_model.http.main.get_model", return_value=object()),
                      patch("property_model.http.main.predict", return_value=[{
                          "recommended_asking_price_zar": 1844000.0,
                          "comparable_count": 5,
                      }]) as predict,
                      patch("property_model.http.main.urlopen", return_value=response) as urlopen):
                    self.assertEqual(valuation(Mock(method="POST", get_json=lambda silent: body))[1], 204)

                self.assertEqual(predict.call_args.args[0], {
                    "province": "Gauteng", "city": "Johannesburg", "suburb": "Berea",
                    "bedrooms": 2, "bathrooms": 1, "floor_size": 85, "rates": 700,
                })
                request = urlopen.call_args.args[0]
                self.assertEqual(request.full_url,
                                 f"https://frms.dev/api/v1/forms/{form_id}/submissions?id={'a' * 32}&partial=true&section_id=prediction")
                self.assertEqual(json.loads(request.data), {"prediction": {
                    "recommended_asking_price_zar": 1844000.0,
                    "comparable_count": 5,
                    "formatted_asking_price": "R\u00a01\u00a0844\u00a0000",
                }})
                self.assertEqual(request.get_method(), "POST")
                self.assertEqual(urlopen.call_args.kwargs, {"timeout": 10})

    def test_invalid_identifiers_do_not_load_predict_or_write(self):
        with (patch("property_model.http.main.get_model") as get_model,
              patch("property_model.http.main.predict") as predict,
              patch("property_model.http.main.urlopen") as urlopen):
            for field, invalid in (
                ("form_id", [None, "", 123, True, [], {}, "a1234567", "a123456789",
                             "b12345678", "a1234567g", "a12345678/../other", "a12345678?x=1",
                             "https://other.example/a12345678", "a12345678\n"]),
                ("id", [None, "", 123, "a" * 31, "g" * 32, "a" * 32 + "?x=1"]),
            ):
                for value in invalid:
                    with self.subTest(field=field, value=value):
                        body = {**self.body, field: value}
                        self.assertEqual(valuation(Mock(method="POST", get_json=lambda silent: body))[1], 400)
                body = {key: value for key, value in self.body.items() if key != field}
                self.assertEqual(valuation(Mock(method="POST", get_json=lambda silent: body))[1], 400)
            get_model.assert_not_called()
            predict.assert_not_called()
            urlopen.assert_not_called()

    def test_other_events_do_not_predict(self):
        with patch("property_model.http.main.predict") as predict:
            for update in ({"section_id": "location"}, {"section_id": "prediction"},
                           {"section_id": None}, {"status": "completed"}):
                body = {**self.body, **update}
                self.assertEqual(valuation(Mock(method="POST", get_json=lambda silent: body))[1], 204)
        predict.assert_not_called()

    def test_invalid_property_and_api_failure(self):
        invalid = {**self.body, "data": {**self.body["data"], "bedrooms": "0"}}
        self.assertEqual(valuation(Mock(method="POST", get_json=lambda silent: invalid))[1], 400)
        with (patch("property_model.http.main.get_model", return_value=object()),
              patch("property_model.http.main.predict", return_value=[{
                  "recommended_asking_price_zar": 1844000.0,
              }]),
              patch("property_model.http.main.urlopen", side_effect=OSError("offline")),
              patch("property_model.http.main.logging.exception")):
            self.assertEqual(valuation(Mock(method="POST", get_json=lambda silent: self.body))[1], 502)


if __name__ == "__main__":
    unittest.main()
