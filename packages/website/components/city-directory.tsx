"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useState, type ReactElement } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cityPath } from "@/lib/city-routes.mjs";

type City = {
  name: string;
  province: string;
  listingCount: number;
};

export function CityDirectory({ cities }: { cities: City[] }): ReactElement {
  const [query, setQuery] = useState("");
  const search = query.trim().toLocaleLowerCase("en-ZA");
  const matches = cities
    .filter(
      (city) =>
        city.listingCount > 20 &&
        city.name.toLocaleLowerCase("en-ZA").includes(search),
    )
    .sort((left, right) => right.listingCount - left.listingCount);

  return (
    <section aria-label="Cities">
      <div className="relative mx-auto mt-8 mb-8 max-w-lg sm:mb-10">
        <Search
          className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          aria-label="Find your city"
          aria-controls="city-grid"
          placeholder="Find your city…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-14 rounded-lg border-input bg-card pr-4 pl-12 text-base shadow-none md:text-base"
        />
      </div>
      <p role="status" className="sr-only">
        {matches.length} {matches.length === 1 ? "city" : "cities"} found
      </p>
      <div
        id="city-grid"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5"
      >
        {matches.map((city) => (
          <Link
            key={JSON.stringify([city.province, city.name])}
            href={cityPath(city)}
            className="group block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            aria-label={`Explore ${city.name}, ${city.province}`}
          >
            <Card className="h-full gap-5 rounded-lg border-border bg-card py-6 shadow-none transition-colors group-hover:border-primary/40 group-hover:bg-muted/30">
              <CardHeader className="gap-1.5 px-6">
                <CardTitle>
                  <h2 className="text-[22px] leading-snug font-semibold tracking-tight">
                    {city.name}
                  </h2>
                </CardTitle>
                <CardDescription className="text-sm">
                  {city.province}
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-auto px-6">
                <Separator className="mb-5" />
                <p className="text-4xl font-medium tracking-tight tabular-nums">
                  {city.listingCount.toLocaleString("en-GB")}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Recorded listings
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Published in the past 90 days
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      {matches.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {cities.length === 0
            ? "No listings in the past 90 days."
            : "No matching cities. Try another city name."}
        </p>
      )}
    </section>
  );
}
