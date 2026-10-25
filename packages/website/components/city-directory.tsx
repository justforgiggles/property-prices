"use client";

import { Search } from "lucide-react";
import { useState, type ReactElement } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type City = {
  name: string;
  province: string;
  listingCount: number;
};

export function CityDirectory({ cities }: { cities: City[] }): ReactElement {
  const [query, setQuery] = useState("");
  const search = query.trim().toLocaleLowerCase("en-ZA");
  const matches = cities
    .filter((city) =>
      city.listingCount > 20 &&
      city.name.toLocaleLowerCase("en-ZA").includes(search),
    )
    .sort((left, right) => right.listingCount - left.listingCount);

  return (
    <section aria-label="Cities">
      <div className="relative mx-auto mt-8 mb-14 max-w-lg sm:mb-20">
        <Search
          className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          aria-label="Search cities"
          aria-controls="city-grid"
          placeholder="Search for a city…"
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
          <Card
            key={JSON.stringify([city.province, city.name])}
            className="gap-7 rounded-lg border-border bg-card py-6 shadow-none"
          >
            <CardHeader className="gap-1.5 px-6">
              <CardTitle>
                <h2 className="text-xl font-medium tracking-tight">
                  {city.name}
                </h2>
              </CardTitle>
              <CardDescription className="text-sm">
                {city.province}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-6">
              <p className="text-sm text-muted-foreground">
                <span className="mr-1.5 text-2xl font-medium tracking-tight text-foreground tabular-nums">
                  {city.listingCount.toLocaleString("en-GB")}
                </span>
                {city.listingCount === 1 ? "listing" : "listings"}
                <span className="mx-1.5" aria-hidden="true">
                  ·
                </span>
                last 90 days
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      {matches.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {cities.length === 0
            ? "No listings in the last 90 days."
            : "No cities found. Try another city name."}
        </p>
      )}
    </section>
  );
}
