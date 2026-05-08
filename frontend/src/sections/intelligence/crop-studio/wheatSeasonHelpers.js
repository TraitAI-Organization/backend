// Approximate winter-wheat phenology + harvest dates for the major US wheat
// states. Dates are typical mid-points; real-world stage timing varies with
// weather, variety, and elevation. These are "good enough" defaults for the
// hero banner — swap in real per-state model output later if you want.

// Stage transitions for winter wheat. Encoded as month*100 + day so they're
// easy to compare against the current date. The order matters: list latest
// stage first so the lookup falls through cleanly.
const WHEAT_STAGES = [
  { from: 815, label: 'Post-harvest', detail: 'Stubble / fallow' },
  { from: 705, label: 'Maturity', detail: 'Hard dough · ready to combine' },
  { from: 615, label: 'Grain fill', detail: 'Soft to hard dough' },
  { from: 525, label: 'Anthesis', detail: 'Flowering · pollination' },
  { from: 510, label: 'Heading', detail: 'Spike emergence' },
  { from: 415, label: 'Booting', detail: 'Spike forming inside flag leaf' },
  { from: 315, label: 'Stem extension', detail: 'Jointing · rapid growth' },
  { from: 215, label: 'Tillering', detail: 'Tiller production' },
  { from: 115, label: 'Green-up', detail: 'Resuming growth from dormancy' },
  { from: 1015, label: 'Tillering', detail: 'Fall tillering before dormancy' },
  { from: 915, label: 'Emergence', detail: 'Seedlings emerging' },
  { from: 0, label: 'Dormancy', detail: 'Winter dormancy' }
];

// Approximate winter-wheat harvest date by state. Encoded as { month, day }
// where month is 1-indexed. Defaults to Kansas if the requested state isn't
// in this table.
export const STATE_HARVEST_DATES = {
  Texas: { month: 5, day: 25 },
  Oklahoma: { month: 6, day: 12 },
  Kansas: { month: 6, day: 28 },
  Colorado: { month: 7, day: 8 },
  Nebraska: { month: 7, day: 5 },
  Missouri: { month: 6, day: 25 },
  'South Dakota': { month: 7, day: 22 },
  'North Dakota': { month: 8, day: 5 },
  Montana: { month: 8, day: 1 },
  Idaho: { month: 8, day: 5 },
  Washington: { month: 8, day: 12 },
  Oregon: { month: 8, day: 5 },
  Illinois: { month: 6, day: 30 },
  Indiana: { month: 6, day: 28 },
  Ohio: { month: 7, day: 5 },
  Michigan: { month: 7, day: 18 },
  'New Mexico': { month: 6, day: 25 }
};

// Approximate planting date by state — used to compute how far through the
// season we are. Winter wheat is planted in fall; harvest is the following
// summer.
export const STATE_PLANT_DATES = {
  Texas: { month: 9, day: 25 },
  Oklahoma: { month: 9, day: 20 },
  Kansas: { month: 9, day: 18 },
  Colorado: { month: 9, day: 15 },
  Nebraska: { month: 9, day: 12 },
  Missouri: { month: 10, day: 1 },
  'South Dakota': { month: 9, day: 12 },
  'North Dakota': { month: 9, day: 10 },
  Montana: { month: 9, day: 5 },
  Idaho: { month: 9, day: 12 },
  Washington: { month: 9, day: 15 },
  Oregon: { month: 9, day: 18 },
  Illinois: { month: 10, day: 1 },
  Indiana: { month: 10, day: 1 },
  Ohio: { month: 10, day: 1 },
  Michigan: { month: 9, day: 25 },
  'New Mexico': { month: 9, day: 22 }
};

const DEFAULT_PLANT = STATE_PLANT_DATES.Kansas;
const DEFAULT_HARVEST = STATE_HARVEST_DATES.Kansas;

export function getWheatStage(date = new Date()) {
  const monthDay = (date.getMonth() + 1) * 100 + date.getDate();
  for (const entry of WHEAT_STAGES) {
    if (monthDay >= entry.from) return entry;
  }
  return WHEAT_STAGES[WHEAT_STAGES.length - 1];
}

// Days from `date` until the next harvest in `state`. If we're past this
// year's harvest we count to next year's. Returns a non-negative integer.
export function getDaysToHarvest(date = new Date(), state = 'Kansas') {
  const { month, day } = STATE_HARVEST_DATES[state] || DEFAULT_HARVEST;
  let harvest = new Date(date.getFullYear(), month - 1, day);
  if (harvest < date) {
    harvest = new Date(date.getFullYear() + 1, month - 1, day);
  }
  const diffMs = harvest - date;
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

// Percent through the planting → harvest cycle, 0–100. Handles the year-wrap
// correctly: planted in fall of year Y-1 and harvested in summer of year Y.
export function getSeasonProgress(date = new Date(), state = 'Kansas') {
  const plant = STATE_PLANT_DATES[state] || DEFAULT_PLANT;
  const harvest = STATE_HARVEST_DATES[state] || DEFAULT_HARVEST;
  const year = date.getFullYear();
  // Locate the most recently-started growing window we're inside of.
  let plantDate = new Date(year - 1, plant.month - 1, plant.day);
  let harvestDate = new Date(year, harvest.month - 1, harvest.day);
  if (date >= harvestDate) {
    plantDate = new Date(year, plant.month - 1, plant.day);
    harvestDate = new Date(year + 1, harvest.month - 1, harvest.day);
  }
  if (date < plantDate) {
    // Pre-plant gap (between last harvest and next planting). Show as 0.
    return 0;
  }
  const totalMs = harvestDate - plantDate;
  const elapsedMs = date - plantDate;
  return Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100));
}
