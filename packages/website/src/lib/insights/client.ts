import type { Area, Brief, Cohort, Distribution, Evidence } from "./types";
export const propertyLabels = {
  house: "Houses",
  flat: "Flats",
  townhouse: "Townhouses",
} as const;
export type BudgetFit = {
  within: number;
  total: number;
  percentage: number;
  evidence: Evidence;
  reasons: string[];
};
export function findCohort(
  area: Pick<Area, "cohorts">,
  brief: Brief,
): Cohort | null {
  return (
    area.cohorts.find(
      (c) => c.type === brief.type && c.bedrooms === brief.bedrooms,
    ) ?? null
  );
}
function countWithin(distribution: Distribution, budget: number): number {
  return distribution.prices.reduce(
    (count, [price, frequency]) => count + (price <= budget ? frequency : 0),
    0,
  );
}
export function getBudgetFit(cohort: Cohort, budget: number): BudgetFit {
  if (!Number.isSafeInteger(budget) || budget <= 0) {
    return {
      within: 0,
      total: cohort.count,
      percentage: 0,
      evidence: "insufficient",
      reasons: ["Enter a positive whole-rand purchase-price ceiling."],
    };
  }
  const count = countWithin(cohort, budget);
  const percentage = cohort.count ? (count / cohort.count) * 100 : 0;
  let evidence: Evidence = cohort.evidence;
  const reasons = [...cohort.reasons];
  if (evidence === "supported") {
    for (const variant of Object.values(cohort.variants)) {
      const alternative = (countWithin(variant, budget) / variant.count) * 100;
      if (
        Math.abs(alternative - percentage) > 10 ||
        alternative > 50 !== percentage > 50
      ) {
        evidence = "unstable";
        reasons.push(
          "Budget fit changes materially when potentially repeated listings are reduced.",
        );
        break;
      }
    }
  }
  return { within: count, total: cohort.count, percentage, evidence, reasons };
}
export function selectSuburbs(
  areas: Area[],
  brief: Brief,
  budget: number | null = null,
): Area[] {
  return areas
    .filter((area) => {
      const cohort = findCohort(area, brief);
      return (
        cohort &&
        (budget === null
          ? cohort.evidence === "supported"
          : getBudgetFit(cohort, budget).evidence === "supported")
      );
    })
    .sort(
      (a, b) =>
        findCohort(b, brief)!.count - findCohort(a, brief)!.count ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 10)
    .sort(
      (a, b) =>
        findCohort(a, brief)!.median! - findCohort(b, brief)!.median! ||
        a.name.localeCompare(b.name),
    );
}
