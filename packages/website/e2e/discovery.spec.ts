import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  getSharedRows,
  getSupportedRows,
  type ReportCatalog,
  type ReportCity,
} from "../src/lib/reports";
import { formatPrice } from "../src/lib/format";

const comparison = "/compare/western-cape/blouberg/vs/western-cape/cape-town/";
const relocation = "/compare/gauteng/johannesburg/vs/western-cape/cape-town/";
const catalog: ReportCatalog = JSON.parse(
  await readFile(
    new URL("../.generated/reports.json", import.meta.url),
    "utf8",
  ),
);

function cityReport(key: string): ReportCity {
  const city = catalog.cities.find((candidate) => candidate.key === key);
  if (!city) {
    throw new Error(`Missing browser fixture: ${key}`);
  }
  return city;
}

const capeTown = cityReport("western-cape/cape-town");
const blouberg = cityReport("western-cape/blouberg");
const pretoria = cityReport("gauteng/pretoria");

test("the opening search filters an alphabetical directory and shortcuts stay in editorial order", async ({
  page,
}) => {
  await page.goto("/");
  const links = page
    .getByRole("list", { name: "City reports", exact: true })
    .getByRole("link");
  await expect(links).toHaveCount(catalog.cities.length);
  expect(
    await links.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("aria-label")),
    ),
  ).toEqual(catalog.cities.map((city) => `${city.name}, ${city.provinceName}`));
  const shortcuts = page
    .getByRole("navigation", { name: "Start exploring" })
    .getByRole("link");
  expect(await shortcuts.allTextContents()).toEqual([
    "Cape Town ",
    "Johannesburg ",
    "Pretoria ",
    "Durban ",
    "Blouberg ",
    "Sandton ",
  ]);
  const search = page.getByRole("searchbox", { name: "Find your city" });
  await search.fill("CAPE TOWN");
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAccessibleName("Cape Town, Western Cape");
  await search.fill("gauteng");
  await expect(links).toHaveCount(
    catalog.cities.filter((city) => city.provinceSlug === "gauteng").length,
  );
  await search.fill("KwaZulu Natal");
  await expect(links).toHaveCount(
    catalog.cities.filter((city) => city.provinceSlug === "kwazulu-natal")
      .length,
  );
  await search.fill("Not a supported city");
  await expect(
    page.getByRole("heading", { name: "No matching city reports" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(links).toHaveCount(catalog.cities.length);
});

test("city reports show only supported plots and corresponding section links", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Start exploring" })
    .getByRole("link", { name: "Cape Town", exact: true })
    .click();
  await expect(page).toHaveURL(capeTown.href);
  const supported = getSupportedRows(capeTown);
  await expect(page.getByTestId("price-row")).toHaveCount(supported.length);
  await expect(page.getByTestId("price-plot")).toHaveCount(supported.length);
  expect(
    await page
      .getByTestId("price-row")
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-category")),
      ),
  ).toEqual(supported.map((row) => `${row.type}-${row.bedrooms}`));
  for (const [type, id] of [
    ["house", "houses"],
    ["flat", "flats"],
    ["townhouse", "townhouses"],
  ]) {
    const count = supported.some((row) => row.type === type) ? 1 : 0;
    await expect(page.locator(`#${id}`)).toHaveCount(count);
    await expect(
      page.locator(`.report-jump-links a[href="#${id}"]`),
    ).toHaveCount(count);
  }
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByLabel("Asking-price ceiling (R)")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /Suburbs|floor area/i }),
  ).toHaveCount(0);
});

test("obsolete query parameters cannot change a fixed city report", async ({
  page,
}) => {
  await page.goto(pretoria.href);
  const report = await page.locator(".price-report").innerText();
  await page.goto(`${pretoria.href}?type=flat&beds=6&budget=100`);
  await expect(page.locator(".price-report")).toHaveText(report, {
    useInnerText: true,
  });
  await expect(page.getByTestId("price-row")).toHaveCount(
    getSupportedRows(pretoria).length,
  );
});

test("a sparse city omits unsupported bedrooms and entire empty categories", async ({
  page,
}) => {
  const city = cityReport("gauteng/tembisa");
  await page.goto(city.href);
  await expect(page.getByTestId("price-row")).toHaveCount(
    getSupportedRows(city).length,
  );
  await expect(page.locator('[data-category="house-1"]')).toHaveCount(0);
  await expect(
    page.locator('[data-category="house-2"] .distribution-heading strong'),
  ).toBeVisible();
  await expect(page.locator("#flats, #townhouses")).toHaveCount(0);
  await expect(
    page.getByText(
      "Only home categories with enough consistent evidence are shown.",
    ),
  ).toBeVisible();
});

test("exact percentile values and qualifications open with the keyboard", async ({
  page,
}) => {
  await page.goto(pretoria.href);
  const rowData = getSupportedRows(pretoria).find(
    (row) => row.qualificationLabels.length > 0,
  )!;
  const row = page.locator(
    `[data-category="${rowData.type}-${rowData.bedrooms}"]`,
  );
  await expect(row.locator(".distribution-heading strong")).toHaveText(
    formatPrice(rowData.median),
  );
  for (const label of rowData.qualificationLabels) {
    await expect(row.getByText(label, { exact: true })).toBeVisible();
  }
  const details = row.locator(".plot-figures");
  await details.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  for (const label of [
    "5th percentile",
    "25th percentile",
    "Median",
    "75th percentile",
    "95th percentile",
  ]) {
    await expect(details.getByText(label, { exact: true })).toBeVisible();
  }
  for (const reason of rowData.reasons) {
    await expect(details.getByText(reason, { exact: true })).toBeVisible();
  }
  await expect(row.getByRole("img")).toHaveAccessibleName(
    /5th percentile.*25th percentile.*median.*75th percentile.*95th percentile/i,
  );
});

test("the city chooser opens a canonical comparison and has a scoped empty state", async ({
  page,
}) => {
  await page.goto(capeTown.href);
  const chooser = page.locator(".city-chooser > summary");
  await expect(chooser).toContainText("Choose a city to compare");
  await chooser.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".city-chooser")).toHaveAttribute("open", "");
  const search = page.getByRole("searchbox", {
    name: "Find a city",
    exact: true,
  });
  await search.fill("No match here");
  await expect(
    page.getByRole("heading", { name: "No matching comparisons" }),
  ).toBeVisible();
  await search.fill("Blouberg");
  const link = page.getByRole("link", {
    name: "Blouberg, Western Cape",
    exact: true,
  });
  await expect(link).toHaveAttribute("href", comparison);
  await link.click();
  await expect(page).toHaveURL(comparison);
  await expect(page.getByTestId("comparison-row")).toHaveCount(
    getSharedRows(blouberg, capeTown).length,
  );
});

test("pair reports plot only shared categories, use shared section scales and name both references", async ({
  page,
}) => {
  for (const path of [comparison, relocation]) {
    const pair = catalog.pairs.find((candidate) => candidate.href === path)!;
    const left = cityReport(pair.left);
    const right = cityReport(pair.right);
    const shared = getSharedRows(left, right);
    await page.goto(path);
    await expect(page.getByTestId("comparison-row")).toHaveCount(shared.length);
    await expect(page.getByTestId("price-plot")).toHaveCount(shared.length * 2);
    expect(
      await page
        .getByTestId("comparison-row")
        .evaluateAll((rows) =>
          rows.map((row) => row.getAttribute("data-category")),
        ),
    ).toEqual(shared.map((row) => `${row.left.type}-${row.left.bedrooms}`));
    for (const section of await page.locator(".report-category").all()) {
      const domains = await section
        .getByTestId("price-plot")
        .evaluateAll((plots) =>
          plots.map(
            (plot) =>
              `${plot.getAttribute("data-domain-min")}/${plot.getAttribute("data-domain-max")}`,
          ),
        );
      expect(new Set(domains).size).toBe(1);
    }
    for (const row of await page.getByTestId("comparison-row").all()) {
      await expect(row.locator(".distribution-city")).toHaveText([
        left.name,
        right.name,
      ]);
      await expect(row.getByTestId("price-difference")).toContainText(
        left.name,
      );
      await expect(row.getByTestId("price-difference")).toContainText(
        right.name,
      );
    }
    const links = page.getByLabel("Individual city reports").getByRole("link");
    await expect(links.nth(0)).toHaveAttribute("href", left.href);
    await expect(links.nth(1)).toHaveAttribute("href", right.href);
  }
});

test("a coincident distribution renders a single marker without inventing spread", async ({
  page,
}) => {
  await page.goto("/design-system/");
  const plot = page.getByRole("img", {
    name: /All five percentile values coincide/,
  });
  await expect(plot).toHaveCount(1);
  await expect(plot.locator(".plot-median")).toHaveCount(1);
  await expect(plot.locator(".plot-box, .plot-whisker, .plot-cap")).toHaveCount(
    0,
  );
});

test("removed, reversed, self and ineligible report routes return 404", async ({
  request,
}) => {
  for (const path of [
    "/gauteng/",
    "/western-cape/",
    "/kwazulu-natal/",
    "/gauteng/pretoria/montana/",
    "/western-cape/cape-town-vs-blouberg/",
    "/compare/western-cape/cape-town/vs/western-cape/blouberg/",
    "/compare/gauteng/pretoria/vs/gauteng/pretoria/",
    "/compare/gauteng/tembisa/vs/kwazulu-natal/kloof/",
    "/western-cape/not-a-city/",
  ]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});

test("reports, native disclosures and navigation work without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/");
  const directory = page.getByRole("list", {
    name: "City reports",
    exact: true,
  });
  await expect(directory.getByRole("link")).toHaveCount(catalog.cities.length);
  await directory
    .getByRole("link", { name: "Cape Town, Western Cape", exact: true })
    .click();
  await expect(page.getByTestId("price-row")).toHaveCount(
    getSupportedRows(capeTown).length,
  );
  await page.locator(".plot-figures > summary").first().click();
  await expect(
    page
      .locator(".plot-figures")
      .first()
      .getByText("5th percentile", { exact: true }),
  ).toBeVisible();
  await page.locator(".city-chooser > summary").click();
  await page
    .getByRole("link", { name: "Blouberg, Western Cape", exact: true })
    .click();
  await expect(page.getByTestId("comparison-row")).toHaveCount(
    getSharedRows(blouberg, capeTown).length,
  );
  await expect(
    page.locator('[data-category="flat-2"] .distribution-heading strong'),
  ).toHaveCount(2);
  await context.close();
});

for (const width of [320, 390, 1440]) {
  test(`reports and navigation fit ${width}px without errors or duplicate IDs`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const path of [
      "/",
      pretoria.href,
      "/western-cape/st-helena-bay/",
      comparison,
      relocation,
      "/methodology/",
      "/design-system/",
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        path,
      ).toBe(true);
      expect(
        await page.locator("[id]").evaluateAll((elements) => {
          const ids = elements.map((element) => element.id);
          return ids.filter((id, index) => ids.indexOf(id) !== index);
        }),
        path,
      ).toEqual([]);
      if (path === pretoria.href) {
        await page.locator(".city-chooser > summary").click();
        await page
          .getByRole("searchbox", { name: "Find a city", exact: true })
          .fill("western cape");
        await page.locator(".plot-figures > summary").first().click();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
      }
    }
    expect(errors).toEqual([]);
  });
}
