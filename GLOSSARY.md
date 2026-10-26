# Prop Radar

Property advertisements collected from the supported South African locations.

## Language

**Prop Radar**: The project that collects South African property listings and
provides property valuations. The canonical display name is Prop Radar.

**Listing**: A property advertisement on Property24. Different advertisements for
the same property can be separate listings.

**Added listing**: A listing newly saved to the collected dataset during a scrape.
Previously collected listings are not added again.

**Completed scrape**: A collection attempt that finished processing its city
list. Completion does not imply that every city was collected successfully.

**Failed city**: A city whose collection ended with an error. Listings already
collected from that city remain part of the dataset.

**City**: A locality identified by its city name and province in the listing
source. Identical city names in different provinces refer to different cities.

**Reporting window**: The 90 calendar days ending on the data refresh date,
including that date, in South African time. A listing belongs to the window by
its publication date; inclusion does not establish that it is still active.

**Data refresh**: The generation of the website's city listing counts and analytics
from collected advertisements. Its date describes when the summaries were
calculated, not when advertisements were collected or last verified.

**Completed calendar months**: Whole months, from their first through last day,
before the current month in South African time. A three-month period excludes
the current partial month and is distinct from the rolling 90-day reporting window.

**Typical asking price**: The median advertised asking price of the listings in
a stated group and period. It is not a completed sale price or an individual
property valuation.

**Middle half**: The range from the 25th to the 75th percentile of reported
values in a stated group. It describes the central half of those values.

**Asking price per m²**: A listing's asking price divided by its reported floor
area. Group summaries describe these individual ratios, not a ratio of group medians.

**Reported rates and taxes**: The rates-and-taxes amount supplied in a listing.
Its billing period is not verified, so it does not establish a monthly cost.

**Price band**: A group of asking prices bounded by a stated lower and upper
amount, including the lower boundary and excluding the upper. The first and last
bands may be open-ended.

**Residential sale listing**: A recorded advertisement identified as a residential
home for sale, excluding identifiable rentals and non-residential advertisements.
A missing asking price does not remove it from the residential listing count.

**Bedroom band**: A group of advertisements with reported bedrooms within a stated
range. The 2-bedroom band includes 2 to under 3 bedrooms; the 5+ band includes all
valid counts at least 5. All bedrooms also includes studios and unclassified counts.

**Valid observation**: A usable reported value for one metric after its validity
rules are applied. Each metric has its own observation count; an advertisement
can contribute to one metric while lacking a usable value for another.

**Suppressed statistic**: A median or percentile withheld because fewer than five
valid observations are available. Its observation count remains visible.
