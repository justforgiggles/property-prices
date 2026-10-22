import type { Metadata } from "next";
import type { ReactElement } from "react";
import {
  SiteHeader,
  SiteFooter,
  SectionHeading,
  EvidenceDisclosure,
} from "@/components/atlas";
import { formatCount } from "@/lib/format";
import { getReportCatalog } from "@/lib/reports-server";
import { getPageMetadata } from "@/lib/site";

export const metadata: Metadata = getPageMetadata(
  "About the data",
  "Understand Home Atlas asking-price plots, listing records, evidence checks and city comparisons.",
  "/methodology/",
);

export default async function MethodologyPage(): Promise<ReactElement> {
  const { provenance } = await getReportCatalog();
  return (
    <>
      <SiteHeader />
      <main id="main" className="shell">
        <header className="page-intro">
          <p className="eyebrow">The Home Atlas approach</p>
          <h1>
            About <em>the data.</em>
          </h1>
          <p className="intro-copy">
            What the figures show, how we check them, and where they have
            limits.
          </p>
        </header>
        <div className="methodology-body">
          <section>
            <SectionHeading
              eyebrow="01 / The source"
              title="Where the data comes from"
            />
            <p>
              Home Atlas uses recorded residential sale listings from{" "}
              <a
                href="https://www.property24.com/"
                target="_blank"
                rel="noreferrer"
              >
                Property24
              </a>
              . The current 90-day publication window contains{" "}
              {formatCount(provenance.cohortRows)} cleaned listing records. This
              is a selected sample concentrated in Gauteng, Western Cape and
              KwaZulu-Natal, not a census of South Africa’s homes.
            </p>
            <p>
              These are recorded asking prices, not final selling prices.
              Listings may no longer be available. A listing is captured once,
              so we do not have repeated asking prices or sale outcomes.
              Publication dates come from the source; they are neither capture
              dates nor days on market. The analysis date is shown separately.
            </p>
          </section>
          <section>
            <SectionHeading
              eyebrow="02 / The categories"
              title="Which homes we compare"
            />
            <p>
              We consider houses, flats and townhouses with one to four
              bedrooms. Reports show only groups that meet our evidence checks.
              City comparisons require support in both places for the same home
              type and bedroom count. Studios, homes with five or more bedrooms,
              commercial property, land and farms are outside these reports.
            </p>
            <p>
              Listing counts describe our sample, not available stock or market
              size. Homes in the same group can still differ in size, condition
              and exact location.
            </p>
          </section>
          <section>
            <SectionHeading
              eyebrow="03 / The figures"
              title="How to read the plots"
            />
            <p>
              The thin line shows the middle 90% of recorded asking prices, from
              the 5th to the 95th percentile. The box shows the middle half,
              from the 25th to the 75th percentile. The marker shows the median:
              the middle recorded asking price. These describe the sample, not
              predicted selling prices.
            </p>
            <p>
              The line ends are not the lowest and highest listings. Leaving the
              outer 5% at each end out of the plot keeps unusually low or high
              asks from overwhelming the view. It does not remove those records
              from the calculations. Open “About these figures” for all five
              values and any qualifications.
            </p>
            <p>
              Every plot within a home-type section uses the same linear price
              scale, across all shown bedroom counts and both cities in a
              comparison. Scales can differ between sections. Equal values share
              a position, even when this reduces the box to a line. Percentiles
              use linear interpolation between sorted listing prices. Headline
              values are rounded to whole rand; expanded figures retain cents
              where needed.
            </p>
          </section>
          <section>
            <SectionHeading
              eyebrow="04 / Evidence checks"
              title="When we show a category"
            />
            <p>
              Price summaries require at least 30 comparable records and
              sufficient support when potentially repeated listings are reduced.
              We test an image-and-home-details grouping and a broader
              address/image/text grouping. These are sensitivity checks, not
              verified unique-home counts.
            </p>
            <p>
              A category is omitted when either grouping leaves fewer than 30
              records or moves the median by more than 10%. Restricting asks to
              R100,000–R50m must also retain at least 30 records and keep the
              median within 10%. This guardrail tests the result; it does not
              trim the prices used in a published plot. Missing figures never
              become zero prices.
            </p>
            <p>
              We also check 30-, 60- and 180-day publication windows. An
              alternative window with at least 30 records and a median that
              differs by more than 10%, or a shorter window with fewer than 30
              records, produces a visible qualification. Any qualifications
              appear under “About these figures”. These are qualifications of
              the sample, not evidence of price growth or decline.
            </p>
          </section>
          <section>
            <SectionHeading
              eyebrow="05 / City comparisons"
              title="How city differences work"
            />
            <p>
              A comparison is published when both cities have enough consistent
              evidence for at least one matching category. Only those shared
              categories appear. The first city is shown in green and the second
              in terracotta; the colours identify cities and do not indicate
              better or worse value.
            </p>
            <p>
              The rand difference is the second city’s median minus the first
              city’s median. The percentage divides that difference by the first
              city’s median and multiplies by 100. We display whole-rand
              differences and percentages to one decimal place, and label equal
              medians explicitly.
            </p>
            <p>
              Each pair has one report, with city order fixed by province and
              city identifiers. A lower asking price does not establish better
              value. Differences can reverse between home types and bedroom
              counts, and a matching category can contain different homes.
            </p>
          </section>
          <section>
            <SectionHeading
              eyebrow="06 / Geography"
              title="Which areas we cover"
            />
            <p>
              Area names follow the source listings. Places commonly grouped
              together, such as Cape Town and Blouberg, appear separately here.
              Sandton and Johannesburg are also separate source cities. These
              labels do not establish municipal boundaries or equivalent
              neighbourhood experiences.
            </p>
            <p>
              A city report requires at least 100 cleaned records in the main
              window and at least one supported home type and bedroom count.
              Each city uses the same report format, with unsupported categories
              omitted. A small sample does not mean a city has fewer homes or is
              less popular.
            </p>
          </section>
          <EvidenceDisclosure provenance={provenance} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
