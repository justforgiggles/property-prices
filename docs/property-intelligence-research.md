# Property intelligence: what this dataset can help people decide

Research date: **21 October 2026**. Currency: **South African rand (ZAR)**. This is an evidence and product-direction document; no website or collection changes are implemented.

## 1. Recommendation

Build the public proposition around **“Where does my budget buy the home I actually need?”** Help people compare housing choices across areas, understand which requirement constrains their search, and leave with a useful shortlist. Province, city and suburb pages should progressively answer that question.

The strongest initial audience is **active homebuyers comparing areas within a city**, followed by relocating households comparing cities. Their immediate problem is reconciling budget, home requirements and location. Our data can help with the housing part of that decision; it cannot decide whether a neighbourhood suits their commute, safety expectations or lifestyle.

Test **client-ready area comparisons for independent residential agents** as the paid extension. The professional value would be preparing, explaining and reusing a client comparison faster. Consumers should receive the complete comparison and its evidence for free. Monetisation is a hypothesis: this research contains no customer interviews, purchase commitments or demonstrated willingness to pay.

Three conclusions govern the product:

- **There is enough data for selected useful comparisons, not universal local intelligence.** There are 53,989 captured listings, but only 147 suburb × property-type × bedroom segments have at least 30 usable records in the selected 90-day publication cohort.
- **The clearest value is explaining alternatives.** For three-bedroom houses, R2m covers 35 of 39 captured Pretoria North listings but only 4 of 40 in Montana. That gives a buyer a concrete search decision. It does not establish that the same home is cheaper in Pretoria North.
- **Generic statistics and PDF exports already have substitutes.** We must prove clearer decisions and less preparation work, rather than assume our accumulated data alone creates differentiation.

Launch research should prioritise Pretoria, Johannesburg and Durban examples, with selected Western Cape segments where coverage supports them. Retain navigation across Gauteng, Western Cape and KwaZulu-Natal, but do not imply every city or suburb has the same evidence. Treat the other provinces as insufficiently covered.

## 2. What we actually have

### 2.1 Provenance and collection behaviour

The audit scanned every local JSONL record, without sampling. It used the repository's extraction and residential cleaning functions and additional descriptive queries. Appendix B contains the executable analysis; Appendix A defines its measures and publication rules.

| Audit item | Finding |
| --- | --- |
| Raw rows / distinct listing IDs | 53,989 / 53,989 |
| Files / malformed records | 171 / 0 |
| Publication-date range | 1 April–21 October 2026 |
| Residential rows after existing cleaning | 52,943; 1,046 excluded |
| Clean property categories | 30,784 houses; 16,055 flats; 6,104 townhouses |
| Raw geography | 277 province/city combinations; 3,008 province/city/suburb combinations |
| Main analytical cohort | 46,389 cleaned listings published 24 July–21 October 2026, inclusive |
| Repeated observations of an ID | None |

**These are one-time captures, not daily market snapshots.** [Storage](../packages/data/src/storage.ts) partitions records by the listing's publication date and globally rejects previously stored IDs. [The crawler](../packages/data/src/scraper.ts) skips captured IDs. Every filename date matches `datePosted`; the extractor's field named `snapshot` is therefore not an observation timestamp. We cannot recover capture freshness from those dates.

The current [location discovery](../packages/data/src/property24.ts) explicitly targets three provinces. Raw counts are Gauteng **30,346**, Western Cape **12,832**, KwaZulu-Natal **10,556**: **99.53%** together. Other counts are Free State 151, Limpopo 43, Mpumalanga 25, Eastern Cape 22, North West 10 and Northern Cape 4. A national average would mainly describe the collection's chosen geography.

Raw records by publication month are April 33, May 14, June 3,493, July 4,656, August 5,989, September 19,506 and October 20,298. This is not evidence of market growth. Collection scope, incomplete months, publication-date selection and survivorship all affect the composition.

The current crawler uses a 29-day lookback. Its pagination can stop when a page contains no uncaptured recent organic listing, and its city ordering favours already well-covered areas. Those are identifiable completeness risks, not measured estimates of missing listings or proof of historical collection loss. No portal-wide denominator is available.

### 2.2 Fields that determine which insights are possible

Counts below use all **52,943 cleaned residential records**, after feature corrections. Raw coordinate coverage is identified separately.

| Field | Usable/populated count | Product consequence |
| --- | ---: | --- |
| Asking price, location, specific property category | Present in the retained cohort | Core comparison inputs; still require source-label and outlier checks |
| Bedrooms | 52,940 (99.99%) | Strong segmentation variable |
| Bathrooms | 52,941 (99.996%) | Useful refinement, although smaller segments lose support |
| Reported floor area | 34,351 (64.88%) | Use observed values only; never silently fill missing sizes |
| Reported rates and taxes | 35,139 (66.37%) | Partial disclosure; billing period is not stored |
| Coordinates, raw cohort | 10,979 / 53,989 (20.34%) | Insufficient for comprehensive proximity or commute comparisons |

Floor-area coverage differs: **84.36% for flats, 79.34% for townhouses, 51.86% for houses**. Start space comparisons with flats. An advertised `floorSize` field is not independent verification of measured internal space; implausible or mislabelled areas remain possible.

Use `about.description` / extracted `property_type` to distinguish **House**, **Apartment / Flat** and **Townhouse**. The schema's broad `@type = Apartment` includes both flats and townhouses. Pooling them would undermine the comparisons.

The rates parser stores an amount, without a billing period; levies are not captured as a structured field. Do not call the result monthly costs, annualise it, or combine it with a mortgage payment. Missing rates mean unknown. Descriptions are mostly headlines: their median length is 50 characters, and only 65 exceed 200 characters. They cannot establish an amenity inventory, property condition or the absence of solar/security/pools.

The existing cleaner retains prices of at least R10,000 and applies broad numeric bounds. Sixteen retained residential rows exceed R100m; the maximum is R1.25bn. It sets 3 bedroom, 2 bathroom, 106 floor-area and 14 rates values to missing. Medians and central ranges are preferable to means, but robust summaries do not eliminate bad records or composition bias.

### 2.3 Identity, geography and the suburb coverage problem

Distinct listing IDs are not necessarily distinct homes. **948 nonempty image URLs recur across IDs.** The existing model groups related listings through address, image and text rules, producing 49,975 groups from 52,943 cleaned rows. These links can also merge different units in a development or complex. We therefore describe listing records and test deduplication sensitivity rather than claim a verified unique-home count.

Use province + city + suburb as the location identity. Morningside exists under several source cities. Sandton and Randburg are separate from Johannesburg; Blouberg and Durbanville are separate from Cape Town; Centurion and Akasia are separate from Pretoria. These are source-defined areas, not municipal boundaries. A comparison headed “Cape Town” must explain that scope.

| Publication window ending 21 October | Clean listings | Suburbs represented | Suburbs with ≥30 listings, all types | Suburb/type/bedroom segments with ≥30 | Segments with ≥50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 30 days | 27,515 | 2,598 | 221 | 57 | 18 |
| 60 days | 41,698 | 2,940 | 372 | 118 | 36 |
| 90 days | 46,389 | 2,969 | 415 | 147 | 54 |
| 180 days | 52,914 | 2,987 | 467 | 208 | 74 |

A suburb with 100 mixed listings can still have too few examples of the home a visitor wants. Page eligibility must follow the **selected segment**, not the overall suburb total. Extending the window adds evidence but does not make old captures current.

## 3. Audience and competition: where value could exist

### 3.1 Audience priorities

| Audience | Job we can help with | Reason to return / pay | Recommendation |
| --- | --- | --- | --- |
| Active homebuyers | Narrow locations and test compromises before searching individual homes | Return during a search; sustained subscription need is unproven | Primary free audience |
| Relocating households | Translate a budget and home brief between cities | High decision importance, episodic use; non-housing constraints remain critical | Secondary free audience |
| Residential agents handling buyer briefs | Explain alternatives and prepare a comparison for several clients | Repeated preparation work creates a plausible paid job | First paid hypothesis |
| Sellers and listing agents | Understand the spread of advertised asking positions | Need transaction comparables and condition evidence for pricing decisions | Supporting context, not a complete valuation service |
| Investors and developers | Screen advertised product/price combinations | Need rental returns, demand and outcomes that are absent | Defer as a primary audience |

This ranking is a product judgment based on data fit and existing alternatives. It is not a measured market-size or willingness-to-pay result.

### 3.2 First-party research

Sources accessed **21 October 2026**. Prices are displayed offers, not checkout-verified purchases. Page descriptions establish advertised capabilities; we did not audit every dynamic chart or buy reports.

| Existing offer | Evidence | Implication for our positioning |
| --- | --- | --- |
| Property24 public area trends and sales report | The Cape Town page describes asking/sold trends, listing counts, bedroom breakdowns and deeds-derived activity. A recent-sales report is advertised at **R69 including VAT**. [Source](https://www.property24.com/cape-town/property-trends/432) | A page of geographic averages would face a substantial free substitute with deeper outcome data. |
| Lightstone once-off reports | Property/town/suburb reports are listed at **R138 plus VAT**; buyer/seller reports at **R175 excluding VAT**. Reports include transaction and area information absent here. Suburb reports are already marketed for client-facing use. [Source](https://www.lightstoneproperty.co.za/OnlinePropertyReports.aspx) | Neither area reports nor presentation alone is unique. Compete on the specific comparison task and saved work. |
| Lightstone residential subscriptions | Standard **R770/month**, Super User **R1,995/month**, excluding VAT, with differing report allowances. [Source](https://lightstone.co.za/AVM/content/Login/NewRegister.aspx) | A paid professional category exists. These prices do not establish demand for our narrower offer. |
| Private Property neighbourhood guides | Fourways includes neighbourhood description, amenities, listings and a map. [Source](https://www.privateproperty.co.za/neighbourhoods/fourways/373) | Do not mistake housing-price alternatives for equivalent lifestyles. |
| PayProp Rental Index | Its South African page offers national/provincial rental growth and arrears information based on rental transactions. [Source](https://www.payprop.com/za/rental-index) | Asking-sale data cannot substitute for rental performance evidence. |

Lightstone's January 2026 account of its estate-agent survey reports accuracy/freshness (29%), ease of use (21%) and breadth (14%) as leading tool-recommendation factors; nearly two-thirds prioritised seller leads. This is vendor-run, agent-reported evidence with no visible sample size/recruitment details, so it suggests interview questions rather than representative demand estimates. It challenges both an export-only paid proposition and any assumption that agents will accept uncertain freshness. [Survey source](https://corporate.lightstone.co.za/result/Articles/22213?DateFormat=MMM+yyyy)

**Our proposed distinction:** keep the home brief visible, compare the choices it creates, explain what changes when one requirement changes, and expose the evidence behind the answer. It is a testable product distinction, not a claim that no competitor can reproduce it.

## 4. Six avenues, evaluated against real evidence

All worked examples below use the **90-day publication cohort**, unless explicitly stated otherwise. Prices are captured asking prices. “Within budget” means records at or below that asking-price ceiling, not available stock, financing affordability or probability of buying successfully.

### Avenue 1 — Budget fit and changing one requirement

**User question:** “Which areas should I investigate, and what would I have to change to make this search work?”

**Evidence:** For a three-bedroom house at up to R2m, the captured within-budget share is 79.9% in source-defined Johannesburg, 58.3% in Pretoria, 71.0% in Durban and 30.6% in Cape Town. Inside Pretoria, the contrast between Pretoria North and Montana is more actionable than the city median. Section 5 provides the full counts and ranges.

**Province:** identify supported cities matching the chosen budget/type/bedroom brief. **City:** compare supported suburbs with that same brief. **Suburb:** show the central asking range, budget position and explicitly changed alternatives such as townhouses. This supports a shortlist and a decision about which constraint to relax.

A useful additional query changes only the budget: in the same 885 Pretoria three-bedroom-house records, R1.5m includes 327 (36.9%); R2m includes 516 (58.3%); R2.5m includes 667 (75.4%); R3m includes 756 (85.4%). A visitor can see diminishing additions to the observed sample without being advised to spend more.

**Value and limits:** replacing repeated portal-filter searches with an explained comparison is useful if it changes a real shortlist. The data does not measure market-wide availability. Condition, tenure, precise location and other attributes still differ within a type/bedroom segment. Never label a low median “best value.”

**Verdict:** lead free proposition. Treat budget as a purchase-price ceiling provided by the visitor; do not infer borrowing capacity.

### Avenue 2 — Space versus location

**User question:** “If I keep roughly the same budget and bedrooms, how does the amount of space change?”

For **two-bedroom flats asking R1m–R1.5m**, using only reported areas of **30–300 m²**:

| Source city | Matching listings | With usable area | Median area | Middle 50% of areas | Median ask among measured listings |
| --- | ---: | ---: | ---: | --- | ---: |
| Johannesburg | 80 | 61 (76.3%) | 97 m² | 81–110 m² | R1.350m |
| Sandton | 178 | 157 (88.2%) | 89 m² | 78–101 m² | R1.250m |
| Pretoria | 108 | 90 (83.3%) | 74 m² | 62–94.75 m² | R1.197m |
| Durban | 164 | 143 (87.2%) | 90 m² | 78–104.5 m² | R1.200m |
| Cape Town | 72 | 62 (86.1%) | 56.5 m² | 45.25–75.75 m² | R1.295m |
| Blouberg | 68 | 60 (88.2%) | 59 m² | 55.5–64 m² | R1.223m |

**Interpretation:** a relocating buyer can investigate a substantial difference in observed apartment space inside a common budget band. These are different sets of homes at different points inside the band; the result is not an estimated causal “location premium.” Bathroom mixes also differ. It does not establish equivalent quality or liveability.

**Province:** compare cities within the selected province, retaining the same brief. **City:** compare supported suburbs in that price band. **Suburb:** show the observed area distribution and what fraction reported an area. For example, Parklands in Blouberg has 55 matching listings, 49 measured, with a 59 m² median; Morningside in Durban has 35, 30 measured, and 88.5 m². These are evidence examples, not lifestyle substitutes. Many other suburb cells are too small.

The Johannesburg/Cape Town direction survives tighter area limits, narrower price bands and duplicate stress tests. Restricting to one bathroom leaves only 19 measured Johannesburg records, so fully controlled comparisons become sparse. The narrow R1.15m–R1.35m comparison also leaves only 26 measured Johannesburg records. Keep the broader result qualified rather than claiming exact equivalence.

**Verdict:** strong secondary free feature where measured-count and coverage requirements pass. Useful for relocators and households needing more space. Do not produce house price-per-square-metre league tables from the patchier house-area field.

### Avenue 3 — Asking-price position, without a valuation claim

**User question:** “Is this advertised price near the lower, middle or upper part of the observed asking range for this kind of home?”

**Evidence:** Bluff, Durban has 174 three-bedroom-house records: median R1.75m and middle 50% R1.395m–R2.549m. A **hypothetical** R2m asking price is above 102 records and equal to one: approximately the 59th percentile under the midpoint tie convention in Appendix A. It lies inside the central range; the evidence does not identify a bargain or an overpriced property.

**Province:** only broad context, not an individual-home verdict. **City:** compare the spread for the chosen home type and bedrooms. **Suburb:** locate the entered price within a transparent cohort; add bathrooms/area only where the resulting evidence remains adequate. A listing already in the cohort must be removed from its own comparison, along with credible duplicate matches.

This can help a buyer formulate questions or a seller understand advertised competition. It cannot establish a reasonable offer, expected selling price, discount or negotiation leverage. Exact house condition and location are missing. Broad cohort percentiles must not masquerade as property-specific matching.

The existing asking-price model does not solve this gap. Its feature set omits property type, and its saved reference contains training observations. In-sample predictions/self-comparables and the configured 0.98 multiplier are not evidence of undervaluation or a negotiating discount. A future model-derived insight would need type-aware cohorts and independent, property-group-held-out evaluation. See [model features](../packages/model/src/property_model/config.py), [training](../packages/model/src/property_model/train/main.py) and [inference](../packages/model/src/property_model/inference/main.py).

**Verdict:** supporting free explanation and optional report component. Use direct cohort statistics for this concept; no new model is needed. A paid valuation product is not supported.

### Avenue 4 — Client comparison preparation for agents

**User question:** “Can I turn a client's budget and requirements into a defensible set of alternatives without assembling the evidence manually?”

**Evidence-backed output:** for a R2m/three-bedroom-house Pretoria brief, prepare a comparison of Pretoria North, Montana and Faerie Glen, explain why the first is a plausible budget shortlist candidate, show the limited evidence for other constraints, and provide source links for checking particular homes. These are the same factual answers available free; the paid work is organising them around a client's decision.

**Province:** a relocation comparison across selected cities. **City:** a short list of suburbs plus one-requirement alternatives. **Suburb:** asking-position context and questions to verify with the agent. A first report can contain the brief, selected comparisons, a short editable interpretation, evidence counts, publication window, limitations and agent notes in a printable format.

The professional advantage must be **repeatable preparation time saved and better client conversations**. Branding or a PDF button alone is weak differentiation. Existing property reports may already satisfy the job, and uncertain freshness may prevent client use entirely. Agents whose real priority is leads may not value this enough to pay.

**Verdict:** first paid pilot, contingent on observed workflow usefulness. Start with agents working with active buyer briefs in well-covered areas, not a claim to replace all agent research or a complete comparative market valuation.

### Avenue 5 — Reported rates as a question to investigate

**User question:** “What other disclosed charges should I check before choosing between these homes?”

**Evidence:** among three-bedroom houses, reported rates medians are R700 in Lotus Gardens (36/53 reporting), R1,877 in Faerie Glen (30/34), and R2,260 in Westville (35/47). The properties and asking prices differ, and billing periods are absent. These are recorded amounts, not a proven monthly savings comparison.

Disclosure is selective. In Newlands West, the asking-price median is R900k for records with rates versus R1.15m without them. Missing values cannot be treated as random or replaced with the local median when drawing conclusions about costs.

**Province:** disclose whether the field is usable; avoid a province-wide cost ranking. **City:** at most a qualified comparison of reported amounts for the same home brief, after billing-period verification. **Suburb:** show which charges are known and prompt the visitor to verify the rates account, levies and other costs on an individual property. A historical rates amount alone is insufficient.

**Verdict:** do not launch an aggregated ownership-cost insight from the current fields. Retain this avenue as a useful investigation checklist, with reported amounts in evidence detail only. No total-cost score, annualisation or affordability calculator is justified by this analysis.

### Avenue 6 — Investor/developer segment screening

**User question:** “Which advertised product and asking-price combinations warrant further investigation?”

**Evidence:** Pretoria's captured three-bedroom medians are R1.80m for houses (885 records), R1.79m for townhouses (410), and R895k for flats (219). That describes different advertised product mixes. It does not show unmet demand for any of them. Likewise, Cape Town's two-bedroom-flat median of R3.298m exceeds its three-bedroom-house median of R3.20m because these are different cohorts; it is not evidence that converting houses into flats creates value.

**Province:** map captured asking-price segments across cities. **City:** describe product/bedroom/price combinations with counts. **Suburb:** inspect relevant advertised comparisons. Do not label sparse segments market gaps: limited collection or low listing activity can produce the same pattern.

Investors need rent, expenses, vacancy and exit evidence; developers also need land, construction, approvals and absorption evidence. None can be inferred from these counts. High prices, high asking-price dispersion and many listings are not evidence of high returns, strong demand or liquidity.

**Verdict:** defer investment recommendations and paid investor positioning. A descriptive comparison might support a professional's wider research, but the current data does not complete the investment decision.

## 5. Concrete province → city → suburb experience

### 5.1 Landing page: demonstrate a decision before asking for engagement

Suggested promise: **“Find the areas that fit your home budget.”** Supporting explanation: compare captured asking prices for the type of home you need, then investigate the areas that fit.

Use a real, clearly labelled example: **“R2m, three bedrooms, a house: Pretoria North and Montana lead to very different search results.”** Show 35/39 versus 4/40 recorded asks within budget, the publication window and an invitation to change the budget/home brief. The lesson is that the city headline hides important local choices.

Use three inputs initially: purchase-price ceiling, property category and exact bedroom count. Let a visitor choose an area directly or browse provinces. Preserve the brief while navigating. No income inference, account wall or email gate is needed to reach the answer.

Do not headline the country-wide cheapest suburb, an unexplained investment score, recent “growth,” or the total size of the dataset. Acquisition should come from understandable local comparisons and shareable, useful conclusions. Traffic and conversion remain untested.

### 5.2 Province page: choose which cities deserve attention

A relocating visitor's question is **“Where in this province is my housing brief plausible?”** Lead with city comparisons, rather than a province average. A secondary overview can describe the captured mix with its geographic limits.

Three-bedroom houses, R2m ceiling:

| Province | Captured segment n | Median ask | Middle 50% | At/below R2m |
| --- | ---: | ---: | --- | ---: |
| Gauteng | 7,665 | R1.399m | R990k–R1.899m | 6,033 / 7,665 (78.7%) |
| KwaZulu-Natal | 1,789 | R1.600m | R1.150m–R2.400m | 1,184 / 1,789 (66.2%) |
| Western Cape | 2,877 | R3.350m | R2.275m–R4.650m | 631 / 2,877 (21.9%) |

**Interpretation:** the captured housing choices differ substantially, but these pooled proportions weight whatever cities and homes were collected. They are not population estimates, relocation recommendations or like-for-like provincial price premiums. Do not create a “best province” ranking from them.

A Gauteng page should immediately unpack the province summary into supported cities. Keep a clear path to compare cities already acceptable to the visitor; employment and family constraints may rule out otherwise cheaper places.

| Source-defined city | Three-bedroom houses n | Median ask | Middle 50% | At/below R2m |
| --- | ---: | ---: | --- | ---: |
| Johannesburg | 1,139 | R1.450m | R1.090m–R1.850m | 910 (79.9%) |
| Pretoria | 885 | R1.800m | R1.350m–R2.500m | 516 (58.3%) |
| Sandton | 143 | R3.100m | R2.500m–R4.150m | 14 (9.8%) |
| Durban | 599 | R1.597m | R1.200m–R2.263m | 425 (71.0%) |
| Cape Town | 428 | R3.200m | R1.800m–R7.496m | 131 (30.6%) |
| Blouberg | 227 | R3.595m | R2.999m–R4.273m | 8 (3.5%) |

The table above spans provinces for research; an actual province page shows its own cities, with an explicit cross-province comparison action. “More matching records” means deeper captured evidence, not a larger or more liquid market. Explain the source-defined city boundaries near the selector.

The page should finish with a decision: select one or several cities to inspect, or change the home brief. Show the housing trade-off, not a recommendation about where a household ought to live.

### 5.3 City page: Pretoria, worked through as a buyer's decision

**Visitor:** “I can spend up to R2m, need three bedrooms and prefer a house. I know Pretoria could work but don't know which suburbs to investigate.”

The page should answer these questions in order:

| Page block | What the visitor learns | Concrete content and next action |
| --- | --- | --- |
| 1. Brief and answer | Does the captured evidence contain plausible choices? | “516 of 885 captured three-bedroom-house asks were at or below R2m.” Show selected geography, exact bedrooms and publication window. Keep the budget editable. |
| 2. Suburb comparison | Which acceptable areas should I inspect? | Display central ranges, within-budget counts/shares and sample support for eligible suburbs. Let the visitor select areas they would consider; avoid presenting cheapest as best. |
| 3. Explain the difference | What varies besides location? | Keep property category/bedrooms fixed; reveal bathroom mix and area coverage. Say when measured sizes cannot support a comparison. |
| 4. Change one requirement | Is the constraint location, budget or property category? | Compare a budget change or a switch to townhouses explicitly. Never relax a requirement silently. |
| 5. Inspect evidence | How was this answer formed? | Cohort definition, counts, range meaning, limitations and historical source examples. Check current availability on the source portal. |
| 6. Leave with a next step | What should I do now? | Open suburb detail, share the selected comparison, or investigate source listings. A separate professional-report action can follow the completed free answer. |

Core suburb comparison for this brief:

| Pretoria suburb | n | Median ask | Middle 50% | At/below R2m | Buyer interpretation |
| --- | ---: | ---: | --- | ---: | --- |
| Lotus Gardens | 53 | R1.050m | R890k–R1.300m | 53 / 53 (100%) | Investigate if the area's housing and location suit; sample size/condition mix may differ substantially. |
| Pretoria North | 39 | R1.500m | R1.335m–R1.643m | 35 / 39 (89.7%) | A plausible budget shortlist candidate in this captured sample. |
| Montana | 40 | R2.460m | R2.281m–R2.499m | 4 / 40 (10%) | Few captured houses fit the ceiling; investigate a different home category or area. |
| Faerie Glen | 34 | R2.999m | R2.656m–R3.200m | 2 / 34 (5.9%) | This brief has little support within budget in the captured sample. |

The **aha** is the difference between the city-level “R2m can work” answer and the local choices it implies. The product is useful when it narrows the search or helps a household consciously relax one constraint.

Do not claim Lotus Gardens offers the same house for a third of the Faerie Glen price. Only 24/53 Lotus Gardens houses report floor area, versus 29/34 in Faerie Glen. The measured medians differ, and the missingness prevents a reliable equivalence claim. Adding exactly two bathrooms reduces these cohorts to 29 and 22 respectively, below the standard headline threshold.

**A promising but fragile type-change example:** Montana has 20/36 three-bedroom townhouses at or below R2m versus 4/40 houses. However, conservative image deduplication reduces the townhouse result to 14/30 and moves its median from R1.67m to R2.125m. The existing model's broader grouping leaves 29 townhouse groups. The direction suggests an alternative worth investigating, but “most townhouses fit” and “typical ask R1.67m” are not robust headlines. Keep this as a qualified research example pending duplicate review, not the landing-page promise.

Montana Park also illustrates why raw counts are insufficient for eligibility: its 33 three-bedroom-house records reduce to 27 under either duplicate policy. Keep that segment out of the main suburb comparison pending identity review; a limited-evidence detail view can explain the smaller sample.

### 5.4 Suburb page: understand a chosen brief

For **Pretoria North → three-bedroom houses → R2m**, lead with the observed range and budget fit: median R1.50m, middle 50% R1.335m–R1.643m, 35/39 records at or below budget. Include that current availability is unverified.

The page then answers:

1. **What is typical in this captured segment?** Central asking range, count and the visitor's budget position. Explain that half the observed asks lie outside the middle-50% range.
2. **How precise is the comparison?** Show which requirements are fixed and what remains unknown. Only 16/39 records report area: suppress an area-based headline. Do not substitute city averages as if they were local observations.
3. **What if I change a requirement?** Recompute for a chosen property category, bedroom count or bathroom requirement. Adding exactly two bathrooms leaves 27 records, so downgrade the evidence status visibly.
4. **What should I verify on a real home?** Condition, area measurement, rates period, levies/tenure and availability. Link historical examples as evidence, not as confirmed active listings.
5. **What alternatives should I compare?** Offer user-selected, adequately supported areas from the same source city. Describe them as housing-price alternatives, never equivalent neighbourhoods.

For a larger cohort such as Bluff's three-bedroom houses, an asking-position module can be shown with its broad-cohort limitations. Do not add a mandatory percentile module to every suburb page.

**Sparse case:** source-defined Cape Town has 428 three-bedroom-house records, yet its largest suburb segment is Plumstead with just 17. A Plumstead page should say that the selected brief has insufficient local evidence for a stable summary. It may show the count and historical examples, offer an explicitly longer publication window, or open the parent-city comparison. It must not display a parent median under a Plumstead label. A different property category can have better support: for example, Cape Town City Centre has 82 two-bedroom-flat records. Changing the category requires the visitor's choice.

## 6. Free value and a simple paid offer

The free visitor should be able to complete the job: set a brief, compare supported areas, understand trade-offs, inspect limitations and share the result. Do not hide the useful comparison behind blurred numbers, an email form or a paywall.

| Free public value | Paid professional value to test |
| --- | --- |
| Complete province/city/suburb comparisons | Prepare a comparison around a specific client's brief |
| Asking ranges, budget fit and supported space comparisons | Save and reuse selected scenarios across client work |
| Evidence counts, methodology and source links | Add agent interpretation, verification notes and branding |
| Shareable comparison and ordinary printing | Produce a consistent, client-ready report with dated evidence and limitations |

The paid report must not imply better underlying factual accuracy than the free result. Payment buys preparation and presentation utility. Comparisons should not change because an agent pays.

Start with a manually prepared report pilot before building accounts, subscriptions or a report editor. A minimal report contains one client brief, up to three selected areas, one explicitly changed scenario, explanations, evidence and the agent's notes. No CRM, alerts, lead marketplace or automated market commentary is required to test that job.

A **R299 total, one-month pilot for up to five prepared reports** is a proposed experiment, not a market-derived optimal price or a public offer. Make the total payable amount explicit when testing it. Record preparation effort and requests; a manual pilot is for learning, not evidence of scalable margins. If participants only want free charts or need transaction/freshness data before using reports, reject the paid hypothesis rather than weaken the free product.

Do not assume consumer traffic will automatically create agent customers. Test whether agents can use public comparisons with their own clients and have a repeat preparation need. Seller lead generation remains a different business model and is outside this recommendation.

## 7. Robustness: which conclusions survived

The analysis compared 30-, 60-, 90- and 180-day publication windows; an R100k–R50m price guardrail; conservative image-based duplicate reduction; and the model's broader property-group reduction. These are sensitivity checks on captured records, not confidence intervals for the housing market.

The 90-day baseline has 46,389 rows. Price guarding leaves 46,315; conservative image deduplication 45,960; broad model grouping 43,844. The last is deliberately aggressive and may merge distinct units. Representatives are selected without using price.

| Finding | Checks and outcome | Publication decision |
| --- | --- | --- |
| Pretoria North houses fit R2m more often than Montana houses in the sample | Baseline 89.7% vs 10.0%; image-dedup 89.2% vs 11.4%; broader groups 88.2% vs 12.9%. All duplicate variants retain ≥30 records in each segment. | Suitable qualified comparison. Avoid market-wide probability claims. |
| Pretoria three-bedroom-house central price | Median R1.80m at 60/90/180 days; R1.85m at 30. Duplicate and price guardrails preserve the R1.80m median. | Useful descriptive city context. Nearly all records are recent publication cohorts, so these windows are not independent corroboration. |
| Cape Town three-bedroom-house central price | R2.595m at 30 days; R2.891m at 60; R3.20m at 90 and 180. Price guardrails barely change the 90-day median. | Composition/window sensitive. Do not describe the difference as a price fall or a stable typical-city value. |
| Johannesburg versus Cape Town flat area within R1m–R1.5m | 97 vs 56.5 m² at 90 days; 99 vs 56 at 60; 96.5 vs 56 at 180. Tightening area to 40–150 m² gives 96 vs 58. Broader dedup gives 97.5 vs 56.5. | Direction is useful; retain budget-band, bathroom and missingness qualifications. No exact premium estimate. |
| Montana townhouse budget fit | 55.6% baseline, 46.7% after image dedup; median rises from R1.67m to R2.125m. Broader grouping drops below 30 records. | Do not publish the majority-within-budget or median-price headline without duplicate review. |
| Rates comparisons | Amount medians can survive range trimming, but billing periods, omitted levies and selective reporting remain unresolved. | Mathematical stability does not make an ownership-cost claim valid. |

In short windows, many suburb comparisons fail the sample requirement. Pretoria North has 16 three-bedroom houses in 30 days; Montana has 21. A 30-day setting must downgrade the comparison rather than reuse the 90-day confidence label.

## 8. Priorities and validation before building

### 8.1 Priority order

1. **Validate the free area-comparison journey** with real buyer briefs, starting with the well-supported Pretoria house example and selected flat-space comparisons.
2. **Test professional report preparation** using the same evidence and a small manual paid pilot. Buyer usefulness and professional payment are separate hypotheses.
3. **Add broad asking-position context** only where visitors understand the distinction from valuation and cohorts remain adequate.
4. **Defer aggregate rates/cost insights and investor recommendations.** Missing periods, outcomes and demand data are capability gaps, not presentation problems.

The research identifies capabilities worth testing; it does not authorise collecting new datasets or imply that a full website is the next necessary step.

### 8.2 Concrete tests and acceptance criteria

These are proposed decision gates for a small formative study, not statistically representative validation. No recruitment, messages or payments have been performed.

| Test | Method | Evidence to proceed / reason to stop |
| --- | --- | --- |
| Buyer usefulness | Recruit 8 active buyers across at least two covered cities. Obtain a real brief and current shortlist; observe existing search, then give the comparison. | At least 6 identify an actionable area or requirement trade-off and can explain why; at least 4 use it in their next search. Record cases where it merely repeats what they knew. |
| Comprehension | Ask each participant what “35/39 within budget” and the displayed range mean. | All can distinguish captured asks from sold prices/current stock after reading the explanation. Any persistent confusion requires rewriting the core display before launch. |
| Professional workflow | Observe 8 residential agents preparing a real comparison using their usual tools and the proposed report. Counterbalance order to reduce familiarity effects. | At least 5 use the output in real client work and median preparation time falls by ≥30%, without increased correction effort. Track what information still has to be gathered elsewhere. |
| Payment and recurrence | Offer the explicitly priced R299 month pilot after demonstrated usefulness. Observe actual acceptance, delivery and repeat requests. | At least 3 pay; at least 2 request another report for a separate client during the month. Treat this as reason for a larger trial, not product-market fit. |
| Factual stability | For every promoted insight, rerun coverage, outlier, duplicate and window checks. Review source examples contributing to surprising results. | Suppress unsupported cells and majority/ranking claims that reverse under plausible handling. Never hide a failed test behind a confidence score. |
| Sparse evidence | Test Plumstead three-bedroom houses and Pretoria North with two bathrooms/short windows. | The page explains insufficient/limited evidence and offers explicit alternatives without silently changing geography or home requirements. |

Record the rate of completed comparisons that lead to a shortlist action, rather than treating pageviews as the main success measure. For professionals, track used reports, repeat client briefs, editing time, error corrections and paid continuation. Do not forecast revenue from the size of the listing dataset.

For a later production release, recompute evidence eligibility with each data build and display the analysis date separately from publication coverage. Do not promise live stock or automatic price-change alerts without changing collection. The research deliverable itself requires no deployment, migration or public API change.

## Appendix A. Definitions, guardrails and reproducibility

### A1. Dataset identity

- Repository revision inspected: `ef54b5ccd2af455c5a0334804becdef587055410`.
- Raw-data digest from `read_listings()`: `480f32b00c9b876d53e8ecaefe9afd3006fd8e717df3f777980c30fbfb2f99c1`. Its digest algorithm includes sorted filenames and each line's text; it is not the checksum of a single archive.
- Python **3.14.7**, pandas **3.0.6**. The existing model environment supplied dependencies.
- Full audit includes all raw rows. Worked numerical examples use the cleaned 90-day publication cohort unless marked otherwise. The as-of date is fixed, rather than taken from the machine clock.
- Source extraction/cleaning: [training data module](../packages/model/src/property_model/train/data.py). Geography uses the source breadcrumb hierarchy and existing normalisation. No outside dataset was joined.
- Automated reconciliation passed: retained plus excluded/repeated rows equal the raw total; provincial segment counts sum to the selected segment; budget and measurement numerators do not exceed denominators. All scripts ran successfully. Source and production code were not changed.

### A2. Calculation contracts

| Measure | Exact definition | Required interpretation |
| --- | --- | --- |
| Cohort | Clean rows within the inclusive publication window, selected province/city/suburb, exact `property_type` and exact bedrooms; optional bathrooms/area filters explicitly applied | A non-random sample of captured advertised homes; geography is source-defined |
| Central asking range | 25th and 75th percentiles of numeric asking prices using pandas linear quantile interpolation; median is the 50th percentile | Descriptive middle 50%, not a predicted sale range or confidence interval |
| Budget fit | `count(price <= budget) / count(priced cohort)`; show numerator and denominator | Sample share, not purchase probability, portal inventory share or mortgage affordability |
| Budget-change effect | Compare inclusive budget counts in the same fixed cohort | A change in the search brief, never market growth or new stock |
| Asking position | `100 × (count(price < entered_price) + 0.5 × count(price == entered_price)) / n`; exclude the target and credible duplicates if it is an existing listing | Relative position among captured asks; not valuation or a recommended bid |
| Area distribution | Use reported area only; for worked two-bedroom-flat comparisons, price R1m–R1.5m and area 30–300 m², both inclusive; show usable-area count / full selected cohort count | Descriptive comparison within a budget band; unknown areas remain unknown |
| Asking price per m² | Median of each usable record's `price / area`, not ratio of aggregate medians | Secondary diagnostic only, never a measure of neighbourhood quality or investment return |
| Rates diagnostic | Median of reported numeric amounts, with reporting fraction; sensitivity filter R100–R25,000 | Research-only recorded amounts; no period or total-cost claim |
| Duplicate sensitivity | Conservative: nonempty identical image + province/city/suburb/type/bedrooms/bathrooms/area; broad: existing model property groups. Keep first by publication date then ID within the cohort | Neither method proves unique-home identity; record any change in conclusion |

Prices in narrative tables are rounded to useful rand/k/m units; calculations use unrounded values. Percentages may differ slightly from rounded counts/ranges. Publication age is not days on market, and an analysis date is not a capture date.

### A3. Proposed evidence rules for later page implementation

These are conservative editorial defaults, not statistical guarantees. No count threshold cures selection bias.

- **At least 30 comparable listing records:** eligible for a qualified central range and budget share, subject to sensitivity checks. Show the count and window at every geographic level.
- **20–29:** limited evidence; show count and a qualified descriptive range in detail, but no ranking, exact percentile or prominent comparative claim. **Below 20:** count and examples only; suppress the local aggregate headline.
- **Space comparisons:** at least 30 valid measured records and at least 70% usable-area coverage in each compared cohort. Repeat with tighter plausible area bounds. Failing either requirement suppresses the comparison; do not impute to pass it.
- **Headline comparisons:** require the two main 90-day cells and duplicate variants to retain support. Flag median shifts over 10%, budget-share shifts over 10 percentage points, or any reversal of the stated conclusion. Smaller movements can still invalidate a majority claim. Window sensitivity must be disclosed when shorter cohorts are too small; a sufficiently supported window that reverses a conclusion prevents an unqualified headline.
- **Rates:** no aggregated cost claim until units/periods are established. Statistical sample size alone does not permit publication.
- **Sparse fallback:** explicitly offer a longer window, a different home requirement or parent-area context. The visitor chooses; keep parent data labelled with its actual geography. Do not pool types or reuse an unrelated local median silently.
- **No current-stock or trend language:** examples are historical captured records with publication dates. Source links may no longer resolve. Explain absent availability checks before presenting examples.

These rules qualify the worked examples, not every possible future combination. Before promoting another segment, run the same checks for that segment.

### A4. Claims to reject

The current data does not establish: achieved selling prices; fair value or undervaluation; price cuts; negotiation discounts; time on market; sales/absorption rates; current available inventory; buyer demand; rental yield; capital growth; total ownership costs; amenity absence; neighbourhood safety, commute or school quality; or a representative national market ranking.

A model-generated number or attractive visual does not supply missing evidence. The useful product is a transparent explanation of housing choices that the captured data can actually describe.

## Appendix B. Executable analysis

Copy the following code into `/tmp/property-intelligence-analysis.py` and run from the repository root:

```sh
packages/model/.venv/bin/python /tmp/property-intelligence-analysis.py > /tmp/property-intelligence-analysis.json
```

It reads the local raw files, uses the existing cleaner, performs the comparisons and reconciliation checks, and prints JSON. It does not train a model, scrape, or alter source data. With the data digest above, it reproduces the analytical tables. With different data or extraction code, expect different results and compare the digest first. The long output also contains exploratory small cells that the publication rules intentionally suppress.

```python
"""Reproduce the descriptive analysis; run from the repository root."""
import json
from pathlib import Path

import numpy as np
import pandas as pd

from property_model.train.data import read_listings, clean_listings, property_groups

AS_OF = pd.Timestamp('2026-10-21')
raw, source, labels = read_listings('data/raw')
clean, audit = clean_listings(raw)
clean['date'] = pd.to_datetime(clean.date)
clean['group'] = property_groups(clean)


def window(days):
    return clean[clean.date.between(AS_OF - pd.Timedelta(days=days - 1), AS_OF)].copy()


def segment(frame, kind='House', beds=3):
    return frame[(frame.property_type == kind) & (frame.bedrooms == beds)]


def describe(frame, budget=2_000_000):
    prices = frame.price
    return dict(n=len(frame), p25=prices.quantile(.25), median=prices.median(),
                p75=prices.quantile(.75), budget=budget,
                within=int((prices <= budget).sum()),
                within_pct=100 * (prices <= budget).mean(),
                size_n=int(frame.floor_size.notna().sum()),
                size_median=frame.floor_size.median(),
                rates_n=int(frame.rates.notna().sum()), rates_median=frame.rates.median())


def grouped(frame, keys, budget=2_000_000, minimum=1):
    output = []
    for key, group in frame.groupby(keys, dropna=False):
        if len(group) < minimum:
            continue
        key = key if isinstance(key, tuple) else (key,)
        output.append(dict(zip(keys, key)) | describe(group, budget))
    return output


c90 = window(90)
houses = segment(c90)
flats = segment(c90, 'Apartment / Flat', 2)
province_raw = raw.groupby('province').size()
raw_numeric = raw.copy()
for col in ['price', 'bedrooms', 'bathrooms', 'floor_size', 'rates']:
    raw_numeric[col] = pd.to_numeric(raw_numeric[col], errors='coerce')
output = dict(source=source, audit=audit, as_of=str(AS_OF.date()),
              raw_ids=raw.id.nunique(), clean_groups=clean.group.nunique(),
              file_date_mismatches=int((raw.date != raw.snapshot).sum()),
              raw_provinces=province_raw.to_dict(),
              raw_months=raw.date.str.slice(0, 7).value_counts().sort_index().to_dict(),
              raw_cities=raw[['province', 'city']].drop_duplicates().shape[0],
              raw_suburbs=raw[['province','city','suburb']].drop_duplicates().shape[0],
              raw_date_min=raw.date.min(), raw_date_max=raw.date.max(),
              description_median_length=raw.description.fillna('').str.len().median(),
              unknown_locations=clean[['province','city','suburb']].eq('__unknown__').sum().to_dict(),
              clean_types=clean.property_type.value_counts().to_dict(),
              raw_present=raw_numeric[['bedrooms','bathrooms','floor_size','rates']].notna().sum().to_dict(),
              clean_present=clean[['bedrooms','bathrooms','floor_size','rates']].notna().sum().to_dict(),
              raw_extremes=raw_numeric[['price','bedrooms','bathrooms','floor_size','rates']].agg(['min','max']).to_dict(),
              high_price_n=int((clean.price > 100_000_000).sum()),
              raw_images_reused=int((raw[raw.image.ne('')].image.value_counts()>1).sum()))
output['type_coverage'] = grouped(clean, ['property_type'])
output['coverage'] = []
for days in [30, 60, 90, 180]:
    f = window(days)
    suburbs = f.groupby('suburb_key').size()
    cells = f.groupby(['suburb_key','property_type','bedrooms']).size()
    output['coverage'].append(dict(days=days, n=len(f), suburbs=len(suburbs),
       suburbs_ge20=int((suburbs >= 20).sum()), suburbs_ge30=int((suburbs >= 30).sum()),
       suburbs_ge50=int((suburbs >= 50).sum()), cells=len(cells),
       cells_ge20=int((cells>=20).sum()), cells_ge30=int((cells>=30).sum()),
       cells_ge50=int((cells>=50).sum())))
output['provinces_houses3'] = grouped(houses, ['province'])
output['provinces_flats2'] = grouped(flats, ['province'], 1_500_000)
output['cities_houses3'] = grouped(houses, ['province','city'], minimum=50)
output['cities_flats2'] = grouped(flats, ['province','city'], 1_500_000, 50)
focus_cities = ['pretoria','johannesburg','durban','cape town','sandton','blouberg']
output['suburbs_houses3'] = grouped(houses[houses.city.isin(focus_cities)], ['province','city','suburb'], minimum=20)
output['suburbs_flats2'] = grouped(flats[flats.city.isin(focus_cities)], ['province','city','suburb'], 1_500_000, 20)
# Sensitivity: baseline vs broad price guardrail and two alternative duplicate policies.
image_keys = ['image','province','city','suburb','property_type','bedrooms','bathrooms','floor_size']
conservative = pd.concat([c90[c90.image.eq('')], c90[c90.image.ne('')].sort_values(['date','id']).drop_duplicates(image_keys)])
aggressive = c90.sort_values(['date','id']).drop_duplicates('group')
trimmed = c90[c90.price.between(100_000, 50_000_000)]
output['sensitivity_counts'] = dict(baseline=len(c90), price_trimmed=len(trimmed),
                                  image_dedup=len(conservative), model_group_dedup=len(aggressive))
output['sensitivity'] = []
for name, f in [('baseline',c90),('price_guard',trimmed),('image_dedup',conservative),('model_groups',aggressive),
                ('30d',window(30)),('60d',window(60)),('180d',window(180))]:
    s = segment(f)
    for city, suburb in [('pretoria',None),('johannesburg',None),('durban',None),('cape town',None),
                         ('sandton',None),('blouberg',None),('pretoria','montana park'),
                         ('pretoria','lotus gardens'),('pretoria','pretoria north'),('pretoria','montana'),
                         ('pretoria','faerie glen'),('durban','bluff'),('durban','westville')]:
        g = s[s.city.eq(city)]
        if suburb:
            g = g[g.suburb.eq(suburb)]
        output['sensitivity'].append(dict(variant=name,city=city,suburb=suburb)|describe(g))
# Size comparisons: do not impute missing sizes. Narrow the home brief and budget.
band = flats[flats.price.between(1_000_000,1_500_000)].copy()
band['valid_size'] = band.floor_size.where(band.floor_size.between(30,300))
output['space'] = []
for city,g in band.groupby('city'):
    if len(g) < 20:
        continue
    measured = g[g.valid_size.notna()]
    output['space'].append(dict(city=city,n=len(g),measured_n=len(measured),
        measured_pct=len(measured)/len(g)*100,size_p25=measured.valid_size.quantile(.25),
        size_median=measured.valid_size.median(),size_p75=measured.valid_size.quantile(.75),
        bathroom_median=measured.bathrooms.median(),
        price_median_measured=measured.price.median(),
        price_median_unmeasured=g[g.valid_size.isna()].price.median(),
        ppm_median=(measured.price/measured.valid_size).median()))
# Rates are recorded amounts with no stored period; no total monthly cost inference.
output['rates'] = []
for (city,suburb),g in houses[houses.city.isin(focus_cities)].groupby(['city','suburb']):
    if len(g)<30:
        continue
    reported=g.rates.dropna()
    filtered=reported[reported.between(100,25_000)]
    output['rates'].append(dict(city=city,suburb=suburb,n=len(g),reported_n=len(reported),
      zero_n=int((reported==0).sum()),median=reported.median(),p25=reported.quantile(.25),
      p75=reported.quantile(.75),guarded_n=len(filtered),guarded_median=filtered.median(),
      price_with_rates=g[g.rates.notna()].price.median(),price_without_rates=g[g.rates.isna()].price.median()))
# Hold extra structural attributes constant to expose city mix confounding.
output['cape_mix'] = []
for typ,beds in [('House',3),('Apartment / Flat',2)]:
    s=segment(c90,typ,beds)
    for city in ['cape town','blouberg','johannesburg','pretoria']:
        g=s[s.city.eq(city)]
        output['cape_mix'].append(dict(city=city,type=typ,bedrooms=beds)|describe(g))
output['pretoria_3bed_2bath'] = grouped(houses[houses.city.eq('pretoria') & houses.bathrooms.eq(2)],['suburb'],minimum=10)
# Asking position is a synthetic brief, not a valuation of an actual property.
bluff=houses[houses.city.eq('durban') & houses.suburb.eq('bluff')]
output['bluff_position'] = dict(describe(bluff),less_than_2m=int((bluff.price<2_000_000).sum()),
                               equal_2m=int((bluff.price==2_000_000).sum()))
# Additional questions: changing one requirement, and stability of space comparisons.
output['pretoria_types3'] = grouped(c90[c90.city.eq('pretoria') & c90.bedrooms.eq(3)],['property_type'])
output['pretoria_townhouses3'] = grouped(segment(c90,'Townhouse',3).query("city == 'pretoria'"),['suburb'],minimum=10)
output['pretoria_budget_ladder'] = [describe(houses[houses.city.eq('pretoria')],b) for b in [1_500_000,2_000_000,2_500_000,3_000_000]]
output['space_sensitivity'] = []
for variant,f in [('90d',c90),('30d',window(30)),('60d',window(60)),('180d',window(180)),('image_dedup',conservative),('model_groups',aggressive)]:
    s=segment(f,'Apartment / Flat',2)
    s=s[s.price.between(1_000_000,1_500_000)]
    for city in ['johannesburg','cape town','durban','sandton','pretoria','blouberg']:
        g=s[s.city.eq(city)]
        for control in ['30-300m2','40-150m2','1bath','1.15-1.35m']:
            matching=g
            if control=='1bath': matching=matching[matching.bathrooms.eq(1)]
            if control=='1.15-1.35m': matching=matching[matching.price.between(1_150_000,1_350_000)]
            m=matching[matching.floor_size.between(40 if control=='40-150m2' else 30,150 if control=='40-150m2' else 300)]
            output['space_sensitivity'].append(dict(variant=variant,city=city,control=control,
                matching_n=len(matching),n=len(m),measured_pct=100*len(m)/len(matching) if len(matching) else None,
                size=m.floor_size.median(),price=m.price.median()))
output['space_suburbs'] = []
for (province,city,suburb),g in band.groupby(['province','city','suburb']):
    measured=g[g.valid_size.notna()]
    if len(g)>=20:
        output['space_suburbs'].append(dict(province=province,city=city,suburb=suburb,n=len(g),measured_n=len(measured),size=measured.valid_size.median()))
output['sparse_example'] = grouped(houses[houses.city.eq('cape town')],['suburb'])

output['montana_type_sensitivity'] = []
for variant,f in [('90d',c90),('30d',window(30)),('60d',window(60)),('180d',window(180)),('image_dedup',conservative),('model_groups',aggressive)]:
    for typ in ['House','Townhouse']:
        g=segment(f,typ,3)
        g=g[g.city.eq('pretoria') & g.suburb.eq('montana')]
        output['montana_type_sensitivity'].append(dict(variant=variant,type=typ)|describe(g))

# Original non-model fields audited without exporting contacts or street addresses.
extra=dict(coordinates=0,street=0,long_description=0)
for file in sorted(Path('data/raw').glob('*.jsonl')):
    for line in file.read_text().splitlines():
        r=json.loads(line); node=r['jsonld'][0]['@graph'][0]; p=node['about']
        extra['coordinates']+=int(p.get('latitude') is not None and p.get('longitude') is not None)
        extra['street']+=int(bool(p['address'].get('streetAddress')))
        extra['long_description']+=int(len(node.get('description',''))>200)
output['extra_fields']=extra
# Verify distinct segments reconcile, numerator counts stay within their denominator.
assert audit['raw_rows']-audit['excluded_rows']-audit['repeated_ids_removed']==audit['valid_rows']
assert sum(x['n'] for x in output['provinces_houses3'])==len(houses)
assert all(x['within']<=x['n'] for x in output['cities_houses3'])
assert all(x['measured_n']<=x['n'] for x in output['space'])
assert all(x['n']<=x['matching_n'] for x in output['space_sensitivity'])
assert len(c90)==sum(c90.groupby('province').size())

def safe(value):
    if isinstance(value,dict): return {str(k):safe(v) for k,v in value.items()}
    if isinstance(value,(list,tuple)): return [safe(v) for v in value]
    if isinstance(value,(np.integer,)): return int(value)
    if isinstance(value,(float,np.floating)): return None if not np.isfinite(value) else float(value)
    return value

print(json.dumps(safe(output),indent=2,allow_nan=False))
```
