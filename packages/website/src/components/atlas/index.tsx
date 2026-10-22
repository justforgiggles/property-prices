import Link from "next/link";
import { ArrowUpRight, Compass, Plus } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { formatDate } from "@/lib/format";
import type { PropertyType, Provenance } from "@/lib/insights/types";

export function SiteHeader(): ReactElement {
  return (
    <header className="atlas-header shell">
      <Link href="/" className="brand" aria-label="Home Atlas home">
        <Compass size={29} strokeWidth={1.5} />
        <span>
          Home Atlas<span className="brand-dot">.</span>
        </span>
      </Link>
      <nav aria-label="Main navigation">
        <Link href="/#cities">
          Explore cities <ArrowUpRight size={15} />
        </Link>
        <Link href="/methodology/" className="desktop-link">
          About the data
        </Link>
      </nav>
    </header>
  );
}

export function SiteFooter(): ReactElement {
  return (
    <footer className="atlas-footer shell">
      <div>
        <Link href="/" className="brand">
          Home Atlas<span className="brand-dot">.</span>
        </Link>
        <p>A field guide to home asking prices.</p>
      </div>
      <div>
        <Link href="/#cities">
          Explore cities <ArrowUpRight size={14} />
        </Link>
        <p className="fine-print">
          Selected cities in Gauteng, Western Cape and KwaZulu-Natal.
        </p>
        <Link href="/methodology/">
          About the data <ArrowUpRight size={14} />
        </Link>
      </div>
    </footer>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
  id,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
  id?: string;
}): ReactElement {
  return (
    <div className="section-heading" id={id}>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        {description && <p className="section-description">{description}</p>}
      </div>
      {action && <div className="section-action">{action}</div>}
    </div>
  );
}

export function EvidenceDisclosure({
  provenance,
  reasons = [],
}: {
  provenance?: Provenance;
  reasons?: string[];
}): ReactElement {
  return (
    <details className="evidence-disclosure">
      <summary>
        About this report <Plus size={17} aria-hidden="true" />
      </summary>
      <div className="evidence-content">
        <p>
          Each report groups recorded asking prices by property category and
          bedroom count. Price summaries appear only when the evidence meets our
          checks. Each shown group includes its listing count. Homes can still
          differ in size, condition and exact location.
        </p>
        <p>
          Asking prices may differ from final selling prices. Listings may no
          longer be available. Area names follow the source listings; some
          places commonly grouped together appear as separate cities here.
        </p>
        {provenance && (
          <dl>
            <div>
              <dt>Listing publication dates</dt>
              <dd>
                {formatDate(provenance.windowStart)}–
                {formatDate(provenance.asOf)}
              </dd>
            </div>
            <div>
              <dt>Analysis updated</dt>
              <dd>{formatDate(provenance.generatedAt)}</dd>
            </div>
          </dl>
        )}
        {reasons.length > 0 && (
          <ul>
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

export function ReportJumpLinks({
  types,
  showCompare = false,
}: {
  types: PropertyType[];
  showCompare?: boolean;
}): ReactElement {
  const categories = [
    { type: "house", id: "houses", label: "Houses" },
    { type: "flat", id: "flats", label: "Flats" },
    { type: "townhouse", id: "townhouses", label: "Townhouses" },
  ] as const;
  return (
    <nav className="report-jump-links" aria-label="Report sections">
      <span>In this report</span>
      {categories
        .filter((category) => types.includes(category.type))
        .map((category) => (
          <a key={category.id} href={`#${category.id}`}>
            {category.label}
          </a>
        ))}
      {showCompare && (
        <a href="#compare">
          Compare cities <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      )}
    </nav>
  );
}
