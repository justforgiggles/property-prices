"use client";

import { useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PriceRangeVisual } from "@/components/price-range";
import {
  bedroomTabs,
  bucketLabel,
  formatMonth,
  type LocationAnalytics,
  type BedroomGroupId,
  compactRand,
  rand,
  type Statistics,
} from "@/lib/city-report";

const chartConfig = {
  listings: { label: "Listings", color: "var(--color-chart-1)" },
  median: { label: "Typical asking price", color: "var(--color-chart-1)" },
  range: { label: "Middle 50% range", color: "var(--color-chart-2)" },
  share: { label: "Share of listings", color: "var(--color-chart-1)" },
} satisfies ChartConfig;

function MetricCard({
  title,
  value,
  perMetre = false,
}: {
  title: string;
  value: Statistics;
  perMetre?: boolean;
}) {
  return (
    <Card className="gap-5 rounded-lg py-6 border-border shadow-none sm:py-7">
      <CardHeader className="px-6 sm:px-7">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-6 sm:px-7">
        <p className="text-4xl font-medium tracking-tight tabular-nums sm:text-[42px]">
          {perMetre ? rand(value.median) : compactRand(value.median)}
          {perMetre && (
            <span className="ml-2 text-base font-normal tracking-normal text-muted-foreground">
              / m²
            </span>
          )}
        </p>
        <PriceRangeVisual
          value={value}
          compact={!perMetre}
          emptyMessage={
            perMetre
              ? "Price per m² isn’t available for this selection."
              : undefined
          }
        />
      </CardContent>
    </Card>
  );
}

export function CityReportDetails({
  analytics,
}: {
  analytics: Pick<LocationAnalytics, "period" | "bedroomGroups">;
}) {
  const [selected, setSelected] = useState<BedroomGroupId>("all");
  const group = analytics.bedroomGroups[selected];
  const report = {
    ...group,
    label: bedroomTabs.find((tab) => tab.id === selected)!.label,
    listings: group.listingCount,
    months: group.months.map((month) => ({
      ...month,
      listings: month.listingCount,
      ...month.askingPrice,
      range:
        month.askingPrice.p25 === null
          ? null
          : [month.askingPrice.p25, month.askingPrice.p75],
    })),
    buckets: group.priceDistribution.buckets.map((bucket) => ({
      ...bucket,
      label: bucketLabel(bucket.min, bucket.max),
      share: bucket.percentage,
    })),
  };
  const change = report.askingPriceChangePercent;
  const hasMonthlyPrices = report.months.some((month) => month.median !== null);

  return (
    <section
      className="mt-14 border-t border-border pt-10 sm:mt-16 sm:pt-12"
      aria-labelledby="bedroom-heading"
    >
      <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="bedroom-heading"
            className="text-2xl font-medium tracking-tight sm:text-3xl"
          >
            Compare by number of bedrooms
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Explore asking prices, listing activity and rates and taxes.
          </p>
        </div>
      </div>
      <Tabs
        value={selected}
        onValueChange={(value) => {
          const tab = bedroomTabs.find((tab) => tab.id === value);
          if (tab) setSelected(tab.id);
        }}
        className="min-w-0 gap-0"
      >
        <div className="-mx-1 overflow-x-auto px-1 pb-2">
          <TabsList
            aria-label="Filter by number of bedrooms"
            className="w-max justify-start gap-1 rounded-lg bg-muted p-1 group-data-[orientation=horizontal]/tabs:h-auto"
          >
            {bedroomTabs.map((item) => (
              <TabsTrigger
                key={item.id}
                value={item.id}
                className="shrink-0 rounded-md px-4 py-2.5 text-sm data-[state=active]:bg-card data-[state=active]:text-foreground group-data-[variant=default]/tabs-list:data-[state=active]:shadow-none"
              >
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent
          value={selected}
          className="mt-5 min-w-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">{report.label}</h3>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              <span className="font-medium tabular-nums text-foreground">
                {report.listings.toLocaleString("en-ZA")}
              </span>{" "}
              {report.listings === 1 ? "listing" : "listings"}
            </p>
          </div>
          <div className="grid min-w-0 gap-5 md:grid-cols-2">
            <MetricCard
              title="Typical asking price"
              value={report.askingPrice}
            />
            <MetricCard
              title="Typical asking price per m²"
              value={report.pricePerSquareMetre}
              perMetre
            />
          </div>

          <div className="mt-5 grid min-w-0 gap-5 md:grid-cols-2">
            <Card className="min-w-0 gap-5 py-6 border-border shadow-none sm:py-7">
              <CardHeader className="px-6 sm:px-7">
                <CardTitle className="text-base font-medium">
                  Listings by month
                </CardTitle>
                <CardDescription>Recent listing activity</CardDescription>
              </CardHeader>
              <CardContent className="min-w-0 px-4 sm:px-5">
                <ChartContainer
                  role="figure"
                  config={chartConfig}
                  className="h-60 w-full"
                  aria-label={`Listings by month: ${report.months.map((month) => `${formatMonth(month.month, true)}: ${month.listings} listings`).join(", ")}`}
                >
                  <BarChart
                    accessibilityLayer
                    data={report.months}
                    margin={{ left: -18, right: 12, top: 22, bottom: 0 }}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="month"
                      tickFormatter={(month) => formatMonth(String(month))}
                      tickLine={false}
                      axisLine={false}
                      tickMargin={12}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                      tickMargin={8}
                    />
                    <ChartTooltip
                      cursor={{ fill: "var(--color-muted)" }}
                      content={
                        <ChartTooltipContent
                          labelFormatter={(label) =>
                            formatMonth(String(label), true)
                          }
                        />
                      }
                    />
                    <Bar
                      dataKey="listings"
                      fill="var(--color-listings)"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={64}
                      isAnimationActive={false}
                    >
                      <LabelList
                        dataKey="listings"
                        position="top"
                        className="fill-foreground text-xs"
                      />
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card className="min-w-0 gap-5 py-6 border-border shadow-none sm:py-7">
              <CardHeader className="px-6 sm:px-7">
                <CardTitle className="text-base font-medium">
                  Asking prices over time
                </CardTitle>
                {hasMonthlyPrices && (
                  <CardDescription>
                    {change === null ? (
                      "There aren’t enough asking prices to compare these months yet."
                    ) : (
                      <>
                        <span className="font-medium text-foreground">
                          {change > 0 ? "+" : ""}
                          {change.toFixed(1)}%
                        </span>{" "}
                        in typical asking price from{" "}
                        {formatMonth(report.months[0].month)} to{" "}
                        {formatMonth(report.months[2].month)}
                      </>
                    )}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="min-w-0 px-4 sm:px-5">
                {hasMonthlyPrices ? (
                  <ChartContainer
                    role="figure"
                    config={chartConfig}
                    className="h-52 w-full"
                    aria-label={`Asking prices by month: ${report.months.map((month) => `${formatMonth(month.month, true)}: ${month.median === null ? "price comparison unavailable" : `typical asking price ${rand(month.median)}, middle 50% range from ${rand(month.p25)} to ${rand(month.p75)}`}`).join("; ")}`}
                  >
                    <ComposedChart
                      accessibilityLayer
                      data={report.months}
                      margin={{ left: 0, right: 16, top: 12, bottom: 0 }}
                    >
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="month"
                        tickFormatter={(month) => formatMonth(String(month))}
                        tickLine={false}
                        axisLine={false}
                        tickMargin={12}
                        padding={{ left: 16, right: 16 }}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) =>
                          `R${(Number(value) / 1_000_000).toFixed(1)}m`
                        }
                        width={58}
                        tickMargin={8}
                      />
                      <ChartTooltip
                        content={({ active, label }) => {
                          const month = report.months.find(
                            (item) => item.month === label,
                          );
                          return active && month ? (
                            <div className="grid gap-2 rounded-lg border border-border bg-card p-3 text-xs shadow-sm">
                              <p className="font-medium">
                                {formatMonth(month.month, true)}
                              </p>
                              <p>Typical asking price: {rand(month.median)}</p>
                              <p>
                                Middle 50% range: {rand(month.p25)} –{" "}
                                {rand(month.p75)}
                              </p>
                            </div>
                          ) : null;
                        }}
                      />
                      <Area
                        type="linear"
                        dataKey="range"
                        connectNulls={false}
                        stroke="none"
                        fill="var(--color-range)"
                        fillOpacity={0.45}
                        isAnimationActive={false}
                      />
                      <Line
                        type="linear"
                        dataKey="median"
                        connectNulls={false}
                        stroke="var(--color-median)"
                        strokeWidth={2.5}
                        dot={{
                          r: 4,
                          fill: "var(--color-median)",
                          stroke: "var(--color-card)",
                          strokeWidth: 2,
                        }}
                        activeDot={{ r: 5 }}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ChartContainer>
                ) : (
                  <div className="flex h-52 items-center justify-center px-3 text-center text-sm text-muted-foreground">
                    There aren’t enough asking prices to compare these months
                    yet.
                  </div>
                )}

                <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="h-0.5 w-4 bg-chart-1" />
                    Typical asking price
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-4 rounded-sm bg-chart-2/45"
                    />
                    Middle 50% range
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-[0.85fr_1.15fr]">
            <Card className="gap-5 py-6 border-border shadow-none sm:py-7">
              <CardHeader className="px-6 sm:px-7">
                <CardTitle className="text-base font-medium">
                  Rates &amp; taxes
                </CardTitle>
                <CardDescription>Typical amount</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col px-6 sm:px-7">
                <p className="text-4xl font-medium tracking-tight tabular-nums">
                  {rand(report.ratesAndTaxes.median)}
                </p>
                <PriceRangeVisual
                  value={report.ratesAndTaxes}
                  label="Middle 50% range"
                  emptyMessage="Rates and taxes aren’t available for this selection."
                />
              </CardContent>
            </Card>
            <Card className="min-w-0 gap-4 py-6 border-border shadow-none sm:py-7">
              <CardHeader className="px-6 sm:px-7">
                <CardTitle className="text-base font-medium">
                  Listings by asking price
                </CardTitle>
                <CardDescription>Compare price brackets.</CardDescription>
              </CardHeader>
              <CardContent className="min-w-0 px-4 sm:px-5">
                {report.priceDistribution.count > 0 ? (
                  <ChartContainer
                    role="figure"
                    config={chartConfig}
                    className="h-56 w-full"
                    aria-label={`Asking price distribution: ${report.buckets.map((bucket) => `${bucket.label}: ${bucket.share?.toFixed(1)}%, ${bucket.count} listings`).join("; ")}`}
                  >
                    <BarChart
                      accessibilityLayer
                      layout="vertical"
                      data={report.buckets.map((bucket) => ({
                        ...bucket,
                        display: `${bucket.share?.toFixed(1)}% · ${bucket.count}`,
                      }))}
                      margin={{ left: 0, right: 86, top: 0, bottom: 0 }}
                    >
                      <XAxis type="number" hide domain={[0, 100]} />
                      <YAxis
                        dataKey="label"
                        type="category"
                        width={88}
                        axisLine={false}
                        tickLine={false}
                        tickMargin={8}
                      />
                      <ChartTooltip
                        cursor={false}
                        content={
                          <ChartTooltipContent
                            formatter={(value) =>
                              `${Number(value).toFixed(1)}% of listings`
                            }
                          />
                        }
                      />
                      <Bar
                        dataKey="share"
                        fill="var(--color-share)"
                        radius={[0, 3, 3, 0]}
                        barSize={16}
                        background={{ fill: "var(--color-muted)", radius: 3 }}
                        isAnimationActive={false}
                      >
                        <LabelList
                          dataKey="display"
                          position="right"
                          offset={8}
                          className="fill-foreground text-[11px] tabular-nums"
                        />
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                ) : (
                  <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
                    No asking prices to compare for this selection.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}
