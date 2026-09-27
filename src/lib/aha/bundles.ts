/** Quick-pick sets from aha_library_seed_v4.json recommended_bundles. */
export const RECOMMENDED_BUNDLES: { name: string; slugs: string[] }[] = [
  { name: "Painting", slugs: ["jobsite-basics", "painting", "ladders", "rolling-scaffold"] },
  { name: "Wallcovering", slugs: ["jobsite-basics", "wallcovering-install", "ladders", "rolling-scaffold"] },
];

/** Templates v4 replaces. Archived only when someone clicks the Settings banner. */
export const V4_ARCHIVE = {
  slugs: ["brush-roll", "airless-spray", "surface-prep"],
  names: ["Paints & coatings"],
};
