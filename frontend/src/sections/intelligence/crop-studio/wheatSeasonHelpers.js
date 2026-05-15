// Winter-wheat phenology helpers for the Crop Studio overview banner.
//
// The stage set here is intentionally trimmed to the three macro-stages
// the USDA NASS Crop Progress survey actually tracks for winter wheat —
// Emerged, Headed, Harvested — plus three calendar-only "gap" stages that
// fill in the windows when NASS isn't reporting (winter dormancy, spring
// pre-heading growth, and post-harvest stubble). When the backend
// /api/v1/season-status endpoint returns a stage key from a live NASS
// pull, the UI should prefer that; these helpers are the offline /
// out-of-survey-window fallback.
//
// NASS only tracks Emerged / Headed / Harvested nationally for winter
// wheat — finer Feekes/Zadoks stages (tillering, jointing, anthesis,
// grain fill, maturity) are not in the federal weekly survey, so we
// don't pretend to identify them here.
//
// Stage reference: University of Nebraska-Lincoln CropWatch wheat
// section, a free land-grant extension resource.

const WHEAT_STAGE_REFERENCE_URL = 'https://cropwatch.unl.edu/wheat';

// Each entry carries the same shape the Overview banner has always
// consumed: { label, detail, description, link, key }. `key` matches
// the stage strings the backend /season-status endpoint can return, so
// lookup-by-key is a one-liner on the frontend.
//
// `from` is encoded as month*100 + day. The calendar lookup walks the
// list from latest stage backward and returns the first entry whose
// `from` is on or before today — so order matters.
const WHEAT_STAGES = [
  {
    key: 'post_harvest',
    from: 815,
    label: 'Post-harvest',
    detail: 'Stubble / fallow',
    description:
      'Wheat has been combined and the field is in stubble or fallow. Residue is being managed for moisture conservation, weed suppression, and the next planting window.',
    link: WHEAT_STAGE_REFERENCE_URL
  },
  {
    key: 'harvested',
    from: 615,
    label: 'Harvested',
    detail: 'Combines moving · grain off the field',
    description:
      'Grain has reached harvest moisture and combines are running. NASS tracks this as "PCT HARVESTED" on the weekly Crop Progress report; the figure climbs from 0% to ~95% over roughly three weeks once harvest gets rolling in a given state.',
    link: WHEAT_STAGE_REFERENCE_URL
  },
  {
    key: 'headed',
    from: 501,
    label: 'Headed',
    detail: 'Spike emerged · yield potential set',
    description:
      'The spike has emerged from the boot and all spikelets are visible above the flag leaf. Yield potential is essentially fixed at this point. NASS tracks this as "PCT HEADED" — the survey runs weekly through the heading window and the figure typically reaches ~95% in 4-6 weeks.',
    link: WHEAT_STAGE_REFERENCE_URL
  },
  {
    key: 'spring_growth',
    from: 315,
    label: 'Spring growth',
    detail: 'Green-up through pre-heading',
    description:
      'Winter wheat has resumed active growth from dormancy and is building biomass toward heading. NASS does not publish a national progress series for this window — the next live reading will be "PCT HEADED" once spikes start emerging.',
    link: WHEAT_STAGE_REFERENCE_URL
  },
  {
    key: 'emerged',
    from: 915,
    label: 'Emerged',
    detail: 'Seedlings up · fall establishment',
    description:
      'Seeds have germinated and seedlings are establishing crowns and tillers before going dormant. NASS tracks this as "PCT EMERGED" on the weekly Crop Progress report; in a normal year the figure reaches ~90% by mid-November.',
    link: WHEAT_STAGE_REFERENCE_URL
  },
  {
    key: 'dormant',
    from: 0,
    label: 'Dormant',
    detail: 'Winter dormancy',
    description:
      'Growth is paused while soil temperatures stay cold. The plant relies on stored energy in the crown. NASS does not publish a progress series during the dormancy gap — the next live reading will not arrive until spring.',
    link: WHEAT_STAGE_REFERENCE_URL
  }
];

// Quick-lookup index for the frontend: given a `stage` key from the
// backend /season-status response, get the same { label, detail,
// description, link } shape the calendar fallback produces. Lets the
// Overview banner render the API stage and the calendar stage from
// the same code path.
export const STAGE_INFO_BY_KEY = WHEAT_STAGES.reduce((acc, stage) => {
  acc[stage.key] = stage;
  return acc;
}, {});

// Approximate winter-wheat harvest date by state. Encoded as { month, day }
// where month is 1-indexed. Defaults to Kansas if the requested state isn't
// in this table.
//
// "United States" is a special aggregate entry — a rough nationwide
// midpoint across the major wheat-producing states (early-season Texas
// through late-season Pacific NW). It anchors the dropdown's first option
// when the user wants the country-wide picture rather than a single state.
export const STATE_HARVEST_DATES = {
  'United States': { month: 7, day: 5 },
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
// summer. The "United States" aggregate is a rough nationwide midpoint.
export const STATE_PLANT_DATES = {
  'United States': { month: 9, day: 20 },
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

// Calendar-only stage estimate. Used when the backend /season-status
// endpoint returns null (NASS unconfigured, dormancy gap, or pre-survey)
// and the UI needs *something* to show. Prefer the live API stage where
// available — this function reads only the calendar.
export function getWheatStage(date = new Date()) {
  const monthDay = (date.getMonth() + 1) * 100 + date.getDate();
  // Walk the list and pick the latest stage whose `from` is on or before
  // today. The harvest/post-harvest windows have higher `from` values
  // than emerged/dormant so they win in late summer; in spring (Mar–
  // Apr) `spring_growth` wins; from mid-Sep to year-end `emerged` wins;
  // Jan–mid-Mar falls through to `dormant`.
  let best = WHEAT_STAGES[WHEAT_STAGES.length - 1];
  for (const entry of WHEAT_STAGES) {
    if (monthDay >= entry.from && entry.from >= best.from) {
      best = entry;
    }
  }
  return best;
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

// Derive a 0–100 "season progress" number from a NASS snapshot. Maps the
// three NASS percents into the same conceptual axis getSeasonProgress
// returns, so the UI can plug either source into the same bar. Returns
// null when the snapshot has no usable signal (e.g. dormancy gap), in
// which case callers should fall back to getSeasonProgress.
//
// Mapping (matches the calendar-stage windows above):
//   harvested_pct > 0  → 85 + harvested_pct * 0.15        (last 15 pts of the bar)
//   headed_pct  > 0    → 50 + headed_pct  * 0.35          (heading window: 50–85)
//   emerged_pct > 0 and date < Mar 1
//                      → 5 + emerged_pct * 0.20           (fall establishment: 5–25)
//   else               → null  (let the calendar take over)
export function deriveSeasonProgressFromNass(snapshot, date = new Date()) {
  if (!snapshot) return null;
  const { harvested_pct: harvested, headed_pct: headed, emerged_pct: emerged } = snapshot;
  if (typeof harvested === 'number' && harvested > 0) {
    return Math.min(100, 85 + harvested * 0.15);
  }
  if (typeof headed === 'number' && headed > 0) {
    return Math.min(85, 50 + headed * 0.35);
  }
  if (typeof emerged === 'number' && emerged > 0 && date.getMonth() < 2) {
    // Only use the emerged signal in fall — by January it's stale and
    // the calendar's "dormant" / "spring_growth" estimate is better.
    return Math.min(25, 5 + emerged * 0.2);
  }
  return null;
}

// Derive a days-to-harvest estimate from a NASS snapshot. Returns null
// when there's no usable signal — callers should fall back to
// getDaysToHarvest(date, state).
//
//   harvested_pct > 0 → (100 - harvested_pct) / 100 * 21
//                       (typical state-level harvest runs ~3 weeks end-to-end)
//   headed_pct    > 0 → ~35 days from full heading to harvest start,
//                       scaled by how complete heading is
//   else              → null
export function deriveDaysToHarvestFromNass(snapshot) {
  if (!snapshot) return null;
  const { harvested_pct: harvested, headed_pct: headed } = snapshot;
  if (typeof harvested === 'number' && harvested > 0) {
    return Math.max(0, Math.round(((100 - harvested) / 100) * 21));
  }
  if (typeof headed === 'number' && headed > 0) {
    // Full heading (~100% headed) → harvest is ~35 days out.
    // Just starting (~5% headed)   → harvest is ~55 days out.
    // Linear in between.
    return Math.max(0, Math.round(55 - (headed / 100) * 20));
  }
  return null;
}
