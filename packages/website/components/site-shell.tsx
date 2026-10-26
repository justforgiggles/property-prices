import Link from "next/link";
import type { ReactNode } from "react";
import { Separator } from "@/components/ui/separator";
import data from "@/data/cities.json";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="border-b border-border bg-muted px-5 py-2.5 text-center text-xs leading-relaxed text-foreground sm:text-sm">
        <p>
          <span className="block sm:inline">
            Data updated{" "}
            <time dateTime={data.generatedAt}>
              {new Intl.DateTimeFormat("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
                timeZone: "Africa/Johannesburg",
              }).format(new Date(data.generatedAt))}
            </time>
          </span>
          <span
            className="mx-2 hidden text-muted-foreground sm:inline"
            aria-hidden="true"
          >
            ·
          </span>
          <span className="inline-block">
            <span className="font-semibold tabular-nums">
              {data.totalListings.toLocaleString("en-GB")}
            </span>{" "}
            listings in the past 90 days
          </span>
        </p>
      </div>
      <div className="mx-auto flex min-h-[calc(100svh-3rem)] max-w-6xl flex-col px-5 sm:px-8">
        <header className="flex items-center py-7 sm:py-8">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            aria-label="Prop Radar home"
          >
            <svg
              viewBox="0 0 32 32"
              className="size-9 shrink-0"
              aria-hidden="true"
            >
              <circle
                cx="16"
                cy="16"
                r="13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <circle
                cx="16"
                cy="16"
                r="7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M16 16V3M16 16l9-9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <circle cx="16" cy="16" r="2" fill="currentColor" />
            </svg>
            <span className="text-base font-bold tracking-[0.16em]">
              PROP RADAR
            </span>
          </Link>
        </header>
        <Separator />
        <main className="flex-1 pb-16 sm:pb-24">{children}</main>
        <footer>
          <Separator />
          <p className="py-7 text-xs text-muted-foreground">
            © {data.windowEnd.slice(0, 4)} Prop Radar
          </p>
        </footer>
      </div>
    </>
  );
}
