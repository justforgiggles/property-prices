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
  cityReports,
  compactRand,
  rand,
  reportPeriod,
  type PriceRange,
} from "@/lib/city-report";

const chartConfig = {
  listings: { label: "Recorded listings", color: "var(--color-chart-1)" },
  median: { label: "Typical asking price", color: "var(--color-chart-1)" },
  range: { label: "Middle half", color: "var(--color-chart-2)" },
  share: { label: "Share of listings", color: "var(--color-chart-1)" },
} satisfies ChartConfig;

function MetricCard({
  title,
  value,
  perMetre = false,
}: {
  title: string;
  value: PriceRange;
  perMetre?: boolean;
}) {
  return (
    <Card className="gap-5 rounded-lg py-6 border-border shadow-none sm:py-7">
      <CardHeader className="px-6 sm:px-7">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
        <CardDescription>
          Median and middle half of recorded listings
        </CardDescription>
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
        <PriceRangeVisual value={value} compact={!perMetre} />
      </CardContent>
    </Card>
  );
}

export function CityReportDetails() {
  const [selected, setSelected] = useState("all");
  const report =
    cityReports.find((item) => item.id === selected) ?? cityReports[0];
  const first = report.months[0];
  const last = report.months[2];
  const change = (last.median / first.median - 1) * 100;

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
            A closer look, by bedroom
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Explore prices, listing patterns and reported costs.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">{reportPeriod}</p>
      </div>
      <Tabs
        value={selected}
        onValueChange={setSelected}
        className="min-w-0 gap-0"
      >
        <div className="-mx-1 overflow-x-auto px-1 pb-2">
          <TabsList
            aria-label="Filter by number of bedrooms"
            className="w-max justify-start gap-1 rounded-lg bg-muted p-1 group-data-[orientation=horizontal]/tabs:h-auto"
          >
            {cityReports.map((item) => (
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
              recorded listings
            </p>
          </div>
          <div className="grid min-w-0 gap-5 md:grid-cols-2">
            <MetricCard
              title="Typical asking price"
              value={report.askingPrice}
            />
            <MetricCard
              title="Asking price per m²"
              value={report.pricePerSquareMetre}
              perMetre
            />
          </div>

          <div className="mt-5 grid min-w-0 gap-5 md:grid-cols-2">
            <Card className="min-w-0 gap-5 py-6 border-border shadow-none sm:py-7">
              <CardHeader className="px-6 sm:px-7">
                <CardTitle className="text-base font-medium">
                  Listings over time
                </CardTitle>
                <CardDescription>
                  Recorded listings by publication month
                </CardDescription>
              </CardHeader>
              <CardContent className="min-w-0 px-4 sm:px-5">
                <ChartContainer
                  role="figure"
                  config={chartConfig}
                  className="h-60 w-full"
                  aria-label={`Recorded listings: ${report.months.map((month) => `${month.month} ${month.listings}`).join(", ")}`}
                >
                  <BarChart
                    accessibilityLayer
                    data={report.months}
                    margin={{ left: -18, right: 12, top: 22, bottom: 0 }}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="month"
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
                      content={<ChartTooltipContent />}
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
                <CardDescription>
                  <span className="font-medium text-foreground">
                    +{change.toFixed(1)}%
                  </span>{" "}
                  in the median from July to September
                </CardDescription>
              </CardHeader>
              <CardContent className="min-w-0 px-4 sm:px-5">
                <ChartContainer
                  role="figure"
                  config={chartConfig}
                  className="h-52 w-full"
                  aria-label={`Monthly asking price, median and middle half: ${report.months.map((month) => `${month.month}: ${rand(month.median)}, ${rand(month.lower)} to ${rand(month.upper)}`).join("; ")}`}
                >
                  <ComposedChart
                    accessibilityLayer
                    data={report.months}
                    margin={{ left: 0, right: 16, top: 12, bottom: 0 }}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="month"
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
                            <p className="font-medium">{month.month} 2026</p>
                            <p>Typical asking price: {rand(month.median)}</p>
                            <p>25th percentile: {rand(month.lower)}</p>
                            <p>75th percentile: {rand(month.upper)}</p>
                          </div>
                        ) : null;
                      }}
                    />
                    <Area
                      type="linear"
                      dataKey="range"
                      stroke="none"
                      fill="var(--color-range)"
                      fillOpacity={0.45}
                      isAnimationActive={false}
                    />
                    <Line
                      type="linear"
                      dataKey="median"
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
                <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="h-0.5 w-4 bg-chart-1" />
                    Median
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-4 rounded-sm bg-chart-2/45"
                    />
                    25th–75th percentile
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-[0.85fr_1.15fr]">
            <Card className="gap-5 py-6 border-border shadow-none sm:py-7">
              <CardHeader className="px-6 sm:px-7">
                <CardTitle className="text-base font-medium">
                  Reported rates &amp; taxes
                </CardTitle>
                <CardDescription>
                  The middle half of reported amounts
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col px-6 sm:px-7">
                <p className="text-4xl font-medium tracking-tight tabular-nums">
                  {rand(report.ratesAndTaxes.median)}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Typical reported amount
                </p>
                <PriceRangeVisual value={report.ratesAndTaxes} />
                <p className="mt-7 max-w-sm text-xs leading-relaxed text-muted-foreground">
                  Reported amounts only. Billing periods are not verified.
                </p>
              </CardContent>
            </Card>
            <Card className="min-w-0 gap-4 py-6 border-border shadow-none sm:py-7">
              <CardHeader className="px-6 sm:px-7">
                <CardTitle className="text-base font-medium">
                  Where asking prices fall
                </CardTitle>
                <CardDescription>
                  Share of listings by price band · percentage / count
                </CardDescription>
              </CardHeader>
              <CardContent className="min-w-0 px-4 sm:px-5">
                <ChartContainer
                  role="figure"
                  config={chartConfig}
                  className="h-56 w-full"
                  aria-label={`Asking price distribution: ${report.buckets.map((bucket) => `${bucket.label}: ${bucket.share.toFixed(1)}%, ${bucket.count} listings`).join("; ")}`}
                >
                  <BarChart
                    accessibilityLayer
                    layout="vertical"
                    data={report.buckets.map((bucket) => ({
                      ...bucket,
                      display: `${bucket.share.toFixed(1)}% · ${bucket.count}`,
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
              </CardContent>
            </Card>
          </div>
          <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
            Illustrative figures for layout preview. “Typical” is the median;
            “middle half” is the 25th–75th percentile. These are asking prices,
            not completed sale prices.
          </p>
        </TabsContent>
      </Tabs>
    </section>
  );
}
