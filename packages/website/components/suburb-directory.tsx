"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { SuburbLink } from "@/lib/city-report";

export function SuburbDirectory({
  suburbs,
  cityName,
  cityHref,
}: {
  suburbs: SuburbLink[];
  cityName: string;
  cityHref: string;
}) {
  const [query, setQuery] = useState("");
  const eligible = suburbs
    .filter((suburb) => suburb.listingCount > 20)
    .sort(
      (a, b) =>
        b.listingCount - a.listingCount ||
        a.name.localeCompare(b.name, "en-ZA"),
    );
  if (eligible.length === 0) return null;
  const matches = eligible.filter((suburb) =>
    suburb.name
      .toLocaleLowerCase("en-ZA")
      .includes(query.trim().toLocaleLowerCase("en-ZA")),
  );
  return (
    <section
      className="mt-14 border-t border-border pt-10 sm:mt-16 sm:pt-12"
      aria-labelledby="suburbs-heading"
    >
      <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <div>
          <h2
            id="suburbs-heading"
            className="text-2xl font-medium tracking-tight sm:text-3xl"
          >
            Explore suburbs in {cityName}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Suburbs with more than 20 recorded listings published in the past 90
            days.
          </p>
        </div>
        <div className="relative w-full shrink-0 sm:w-64">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a suburb…"
            aria-label={`Find a suburb in ${cityName}`}
            aria-controls="suburb-list"
            className="h-11 rounded-lg border-input bg-card pr-3 pl-10 shadow-none"
          />
        </div>
      </div>
      <p role="status" className="sr-only">
        {matches.length} {matches.length === 1 ? "suburb" : "suburbs"} found
      </p>
      <ul
        id="suburb-list"
        className="mt-7 divide-y divide-border border-y border-border"
      >
        {matches.map((suburb) => (
          <li key={suburb.slug}>
            <Link
              href={`${cityHref}${suburb.slug}/`}
              className="group flex items-center justify-between gap-4 rounded-sm px-2 py-4 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-label={`Explore ${suburb.name}, ${cityName}`}
            >
              <span className="min-w-0 text-base font-medium">
                {suburb.name}
              </span>
              <span className="flex shrink-0 items-center gap-3 text-sm tabular-nums sm:gap-5">
                <span>
                  {suburb.listingCount.toLocaleString("en-ZA")}{" "}
                  <span className="text-xs text-muted-foreground">
                    listings
                  </span>
                </span>
                <ArrowRight
                  className="size-4 text-muted-foreground group-hover:text-foreground"
                  aria-hidden="true"
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {matches.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No matching suburbs. Try another suburb name.
        </p>
      )}
    </section>
  );
}
