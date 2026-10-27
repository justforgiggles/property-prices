import manifest from "@/data/city-manifest.json";
import { loadCityAnalytics } from "@/lib/load-city-analytics";
import { LocationPage } from "@/components/location-page";
import { locationMetadata } from "@/lib/location-metadata";
type Params = { province: string; city: string };
export const dynamicParams = false;
export function generateStaticParams(): Params[] {
  return manifest.cities.map((city) => ({
    province: city.provinceSlug,
    city: city.citySlug,
  }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}) {
  const route = await params;
  return locationMetadata(await loadCityAnalytics(route.province, route.city));
}
export default async function CityPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const route = await params;
  return (
    <LocationPage
      analytics={await loadCityAnalytics(route.province, route.city)}
    />
  );
}
