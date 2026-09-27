"""Check the partial webhook and frms.dev update without network calls."""
import json
import unittest
from unittest.mock import MagicMock, Mock, patch

from property_model.http.main import FORM_ID, valuation


class ValuationWebhookTests(unittest.TestCase):
    def setUp(self):
        self.body = {
            "id": "a" * 32,
            "form_id": FORM_ID,
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

    def test_property_save_predicts_and_updates_same_submission(self):
        response = MagicMock(status=200)
        response.__enter__.return_value = response
        with (patch("property_model.http.main.get_model", return_value=object()),
              patch("property_model.http.main.predict", return_value=[{
                  "recommended_asking_price_zar": 1844000.0,
                  "comparable_count": 5,
              }]) as predict,
              patch("property_model.http.main.urlopen", return_value=response) as urlopen):
            self.assertEqual(valuation(Mock(method="POST", get_json=lambda silent: self.body))[1], 204)

        self.assertEqual(predict.call_args.args[0], {
            "province": "Gauteng", "city": "Johannesburg", "suburb": "Berea",
            "bedrooms": 2, "bathrooms": 1, "floor_size": 85, "rates": 700,
        })
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url,
                         f"https://frms.dev/api/v1/forms/{FORM_ID}/submissions?id={'a' * 32}&partial=true&section_id=prediction")
        self.assertEqual(json.loads(request.data), {"prediction": {
            "recommended_asking_price_zar": 1844000.0,
            "comparable_count": 5,
            "formatted_asking_price": "R\u00a01\u00a0844\u00a0000",
        }})

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
