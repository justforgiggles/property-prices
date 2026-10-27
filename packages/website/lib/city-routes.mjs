/** @param {string} name */
export function slugify(name) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** @param {{ name: string, province: string }} city */
export function cityPath(city) {
  return `/${slugify(city.province)}/${slugify(city.name)}/`;
}

/** @param {{ province: string, city: string, name: string }} suburb */
export function suburbPath(suburb) {
  return `/${slugify(suburb.province)}/${slugify(suburb.city)}/${slugify(suburb.name)}/`;
}
