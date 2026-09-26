# Follow one property through the pipeline

This example uses the production model trained on this repository's 28,551
cleaned listings. It deliberately does not reuse the demo's fitted artifacts;
therefore its final price differs from the demo's R274,000 example.

## 1. Input and normalization

```json
{
  "province": "Gauteng",
  "city": "Johannesburg",
  "suburb": "Berea",
  "bedrooms": 2,
  "bathrooms": 1,
  "floor_size": 85,
  "rates": 700
}
```

`data.inputs_frame` validates these seven fields, case-folds geography and
constructs `gauteng|johannesburg` and `gauteng|johannesburg|berea`.
No asking price enters this request, and all four measurements are known.

## 2. Structural information

`features.structural_features` retains the four numbers and adds useful
representations. For this property, bathrooms per bedroom is 0.5, area per
bedroom is 42.5 m², rates per m² is 8.2353, and the area band is
`(50.0, 100.0]`. All missingness indicators are zero.

## 3. Historical evidence

The saved reference contains 41 suburb listings,
5,706 city listings and
14,353 province listings. For example, the smoothed
suburb log-price feature is 12.881724.
These are historical listing counts, not confidence levels.

`comparables.comparable_features` can use the suburb pool because it has at
least five rows. The five closest comparables produce an area-adjusted weighted
median of **R231,649.77**. The closest distance is
0.125; their weighted mean distance is
0.140671. Distance combines shared room, area and
rates information; it is not physical distance in metres.

Structural features, historical summaries and comparable features form a
single row with 70 ordered columns. Historical features for training rows use
other property groups only. Serving uses the entire saved production reference.

## 4. Two learned price branches

The ten LightGBM predictions average to **R275,958.56** after
exponentiation. CatBoost predicts a centered residual; after restoring its
center, the correction is 0.112136 in log-price units.
Applying that correction to the comparable estimate gives
**R259,138.46**.

```text
unrounded = 0.98 × (0.5 × 275958.559936 + 0.5 × 259138.462784)
          = R262,197.541133
rounded   = R262,000
```

The 0.98 multiplier is part of the frozen demo recipe. The email displays the
rounded result directly, without a second adjustment.

## 5. Output and service boundary

The Python webhook maps the form's `floor_area` and `rates_and_taxes` fields to
the model input names, invokes the cached model directly, and inserts
**R262,000** into the existing email. It does not calculate features or a second
price. The webhook returns 204 after Resend accepts the message; the CLI still
returns the recommendation and diagnostics.

If these four measurements were unknown, inference would use the median price
of the selected geographic pool, multiplied by 0.98. It would report zero
structurally matched comparables and null distance/model-disagreement fields.

Reproduce the example with:

```sh
packages/model/.venv/bin/python -m property_model predict
```

The numerical steps above are recorded in `build/example.json` for this fitted
artifact. Future retraining can change them even when the recipe stays fixed.
