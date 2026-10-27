import manifest from "@/data/suburb-manifest.json";
import { loadSuburbAnalytics } from "@/lib/load-suburb-analytics";
import { LocationPage } from "@/components/location-page";
import { locationMetadata } from "@/lib/location-metadata";
type Params = { province: string; city: string; suburb: string };
export const dynamicParams = false;
export function generateStaticParams(): Params[] {
  return manifest.suburbs.map((suburb) => ({
    province: suburb.provinceSlug,
    city: suburb.citySlug,
    suburb: suburb.suburbSlug,
  }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}) {
  const route = await params;
  return locationMetadata(
    await loadSuburbAnalytics(route.province, route.city, route.suburb),
  );
}
export default async function SuburbPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const route = await params;
  return (
    <LocationPage
      analytics={await loadSuburbAnalytics(
        route.province,
        route.city,
        route.suburb,
      )}
    />
  );
}
