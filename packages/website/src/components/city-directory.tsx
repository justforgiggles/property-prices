"use client";

import Link from "next/link";
import { useId, useState, type ReactElement } from "react";
import { ArrowUpRight, ChevronDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export type CityDestination = {
  key: string;
  name: string;
  provinceName: string;
  href: string;
};

function normalizeSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findMatchingCities(
  cities: CityDestination[],
  query: string,
): CityDestination[] {
  const search = normalizeSearch(query);
  return cities.filter((city) =>
    normalizeSearch(`${city.name} ${city.provinceName}`).includes(search),
  );
}

function CitySearch({
  query,
  onChange,
  label,
  discovery = false,
}: {
  query: string;
  onChange: (query: string) => void;
  label: string;
  discovery?: boolean;
}): ReactElement {
  const id = useId();
  return (
    <div className={`directory-search${discovery ? " discovery-search" : ""}`}>
      <Label htmlFor={id}>{label}</Label>
      <div className="directory-search-input">
        <Search size={18} aria-hidden="true" />
        <Input
          id={id}
          type="search"
          value={query}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search by city or province"
          autoComplete="off"
        />
      </div>
    </div>
  );
}

function DirectoryResults({
  cities,
  comparison = false,
  onClear,
}: {
  cities: CityDestination[];
  comparison?: boolean;
  onClear: () => void;
}): ReactElement {
  return cities.length > 0 ? (
    <ul
      className="directory-grid"
      aria-label={comparison ? "Cities to compare" : "City reports"}
    >
      {cities.map((city) => (
        <li key={city.key}>
          <Link
            className="city-directory-link"
            href={city.href}
            prefetch={false}
            aria-label={`${city.name}, ${city.provinceName}`}
          >
            <span>
              <strong>{city.name}</strong>
              <span>{city.provinceName}</span>
            </span>
            <ArrowUpRight size={20} aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  ) : (
    <div className="directory-empty">
      <h3>
        {comparison ? "No matching comparisons" : "No matching city reports"}
      </h3>
      <p>
        {comparison
          ? "Try another city or province name, or clear your search to see available comparisons."
          : "Try another city or province name, or browse all the cities we cover."}
      </p>
      <Button variant="outline" onClick={onClear}>
        Clear search
      </Button>
    </div>
  );
}

export function CityDiscovery({
  cities,
  featured,
}: {
  cities: CityDestination[];
  featured: CityDestination[];
}): ReactElement {
  const [query, setQuery] = useState("");
  const matches = findMatchingCities(cities, query);

  return (
    <>
      <header className="directory-hero discovery-hero" id="cities">
        <div>
          <p className="eyebrow">A field guide to home asking prices</p>
          <h1>
            Understand home
            <br />
            asking prices,
            <br />
            <em>city by city.</em>
          </h1>
        </div>
        <div className="directory-kicker">
          <p>
            Explore what houses, flats and townhouses are advertised for. Choose
            a city to see how asking prices vary by home type and bedroom count.
          </p>
          <CitySearch
            query={query}
            onChange={setQuery}
            label="Find your city"
            discovery
          />
          {featured.length > 0 && (
            <nav className="featured-cities" aria-label="Start exploring">
              <p className="eyebrow">Start exploring</p>
              <ul>
                {featured.map((city) => (
                  <li key={city.key}>
                    <Link
                      className="featured-city"
                      href={city.href}
                      prefetch={false}
                    >
                      {city.name} <ArrowUpRight size={14} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <p className="fine-print">
            Selected cities in Gauteng, Western Cape and KwaZulu-Natal.
          </p>
        </div>
      </header>
      <section
        className="discovery-all-cities"
        aria-labelledby="all-cities-heading"
      >
        <div className="discovery-section-heading">
          <h2 id="all-cities-heading">All city reports</h2>
          <p role="status" className="fine-print">
            {matches.length} city {matches.length === 1 ? "report" : "reports"}
            {query ? " found" : ""}
          </p>
        </div>
        <DirectoryResults cities={matches} onClear={() => setQuery("")} />
      </section>
    </>
  );
}

export function CityDirectory({
  cities,
  comparison = false,
}: {
  cities: CityDestination[];
  comparison?: boolean;
}): ReactElement {
  const [query, setQuery] = useState("");
  const matches = findMatchingCities(cities, query);

  return (
    <div
      className={`city-directory${comparison ? " city-directory-compact" : ""}`}
    >
      <div className="directory-toolbar">
        <CitySearch
          query={query}
          onChange={setQuery}
          label={comparison ? "Find a city" : "Find your city"}
        />
        <p role="status" className="fine-print">
          {matches.length} {comparison ? "comparison" : "city report"}
          {matches.length === 1 ? "" : "s"}
          {query ? " found" : ""}
        </p>
      </div>
      <DirectoryResults
        cities={matches}
        comparison={comparison}
        onClear={() => setQuery("")}
      />
    </div>
  );
}

export function CityChooser({
  cities,
}: {
  cities: CityDestination[];
}): ReactElement {
  return (
    <details className="city-chooser">
      <summary>
        Choose a city to compare <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <CityDirectory cities={cities} comparison />
    </details>
  );
}
