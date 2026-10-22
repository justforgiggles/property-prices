import type { Brief } from "./insights/types";

export function formatPrice(value: number | null): string {
  if (value === null) {
    return "Not enough evidence";
  }
  return `R${new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 0 }).format(value).replace(/\s/g, " ")}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-ZA").format(value).replace(/\s/g, " ");
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function formatBrief(brief: Brief): string {
  const category = { house: "houses", flat: "flats", townhouse: "townhouses" }[
    brief.type
  ];
  return brief.bedrooms === 0
    ? `${category} with no separate bedroom`
    : `${brief.bedrooms}-bedroom ${category}`;
}
