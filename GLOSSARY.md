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

**Data refresh**: The generation of the website's city listing counts from the
collected advertisements. Its date describes when those counts were calculated,
not when the advertisements were collected or last verified.
