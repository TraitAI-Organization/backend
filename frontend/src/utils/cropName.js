// Display-only normalization for crop names. The raw values still flow
// to and from the API unchanged so filters, joins, and POST bodies keep
// matching the database — this layer only patches the user-facing label.
//
// Why this exists: one row in the `crops` table was seeded with a
// duplicated suffix ("Wheat, Hard Spring Wheat"). Renaming it in the DB
// would touch every existing field_season referencing the row and risk
// breaking joins, so we render the corrected label client-side instead.

const CROP_DISPLAY_OVERRIDES = {
  'Wheat, Hard Spring Wheat': 'Wheat, Hard Spring'
};

export function formatCropName(name) {
  if (typeof name !== 'string') return name;
  return CROP_DISPLAY_OVERRIDES[name] ?? name;
}

// Convenience for arrays of crop names (e.g. the "Kinds of wheat grown"
// list on the map popup or any multi-select hint).
export function formatCropNames(names) {
  if (!Array.isArray(names)) return names;
  return names.map(formatCropName);
}
