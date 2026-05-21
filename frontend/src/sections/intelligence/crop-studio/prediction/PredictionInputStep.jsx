import { useEffect, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';

import BarChartOutlined from '@ant-design/icons/BarChartOutlined';
import CloseOutlined from '@ant-design/icons/CloseOutlined';
import DownOutlined from '@ant-design/icons/DownOutlined';
import HistoryOutlined from '@ant-design/icons/HistoryOutlined';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';
import UpOutlined from '@ant-design/icons/UpOutlined';

import { formatCropName } from 'utils/cropName';

// ---------------------------------------------------------------------------
// Feature importance reference data
// ---------------------------------------------------------------------------
// Extracted from the live GenMills CatBoost model (model.cbm) via
// `model.get_feature_importance()` on 2026-05-18 against the 1002-row
// training dataset. Hardcoded here because the model is a single fixed
// artifact — when a new model version is published, regenerate this
// table from `python scripts/build_coverage.py`-style introspection.
//
// `badge` is the user-facing context tag ("You provide this", "Auto-filled
// from your county", etc.) so the panel doubles as a "where does each
// number come from" map. Importance values are CatBoost's native scale
// (sums to ~100 across all features).
const FEATURE_IMPORTANCE_STRONG = [
  { label: 'Acres', importance: 21.48, badge: 'You provide this' },
  { label: 'Longitude', importance: 11.1, badge: 'Auto-filled from your county selection', badgeTone: 'primary' },
  { label: 'Latitude', importance: 6.22, badge: 'Auto-filled from your county selection', badgeTone: 'primary' },
  { label: 'Crop', importance: 5.76, badge: 'You provide this' },
  { label: 'State', importance: 4.92, badge: 'You provide this' },
  { label: 'Total N (lb/ac)', importance: 3.71, badge: 'You provide this — required' },
  { label: 'County', importance: 3.63, badge: 'You provide this' }
];

// Advanced fertilizer breakdowns — exposed in the form's collapsible
// Advanced section. The DAP combined importance (7.37) is significant
// even though only a small subset of growers apply it, so power users
// with detailed records can opt in.
const FEATURE_IMPORTANCE_ADVANCED = [
  { label: 'DAP — Nitrogen (lb/ac)', importance: 4.44, badge: 'Advanced — leave blank if you don’t apply DAP' },
  { label: 'DAP — Phosphorus (lb/ac)', importance: 2.93, badge: 'Advanced — leave blank if you don’t apply DAP' },
  { label: 'Anhydrous Ammonia (lb-N/ac)', importance: 2.69, badge: 'Advanced — 16% of training rows used this' },
  { label: 'Total K (lb/ac)', importance: 1.46, badge: 'Advanced — 87% of training rows had this blank' },
  { label: 'Variety', importance: 1.29, badge: 'Optional — 73% of training rows had this blank' },
  { label: 'Other N (lb/ac)', importance: 1.14, badge: 'Advanced — catch-all for fertilizers not listed' },
  { label: 'UAN Solution (lb-N/ac)', importance: 0.96, badge: 'Advanced — 53% of training rows used this' },
  { label: 'Total P (lb/ac)', importance: 0.63, badge: 'Optional — low impact' }
];

// Bar normalization: longest bar = the highest-importance feature, so
// users see the dominance of `acres` at a glance.
const FEATURE_IMPORTANCE_MAX = Math.max(
  ...FEATURE_IMPORTANCE_STRONG.map((f) => f.importance),
  ...FEATURE_IMPORTANCE_ADVANCED.map((f) => f.importance)
);

// Used for the panel button label and the panel title. Kept as a single
// constant so updates only happen in one place.
const FEATURE_PANEL_BUTTON_LABEL = 'How Inputs Affect Predictions';
const FEATURE_PANEL_TITLE = 'How Your Inputs Affect Predictions';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

// Coerce numeric API values (number | null | undefined) into the string
// representation the form's controlled inputs expect. Empty string means
// "no value", which is what the form treats as a cleared field.
function numToFormString(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : '';
}

// Compact one-line summary of a saved run, used as the dropdown menu item
// label. Order is "crop · variety · season · state · county" so the bits
// that matter most for distinguishing runs (crop and season) lead.
function summarizePrefillRun(run) {
  if (!run) return '';
  const parts = [];
  if (run.crop) parts.push(formatCropName(run.crop));
  if (run.variety) parts.push(run.variety);
  if (run.season != null && run.season !== '') parts.push(String(run.season));
  const loc = [run.state, run.county].filter(Boolean).join(', ');
  if (loc) parts.push(loc);
  return parts.join(' · ');
}

// Shared themed-tooltip slotProps — mirrors the Prefill section's tooltip
// styling (primary-tinted opaque background, primary border, small bold
// text, narrow max-width) so every help-on-hover surface in the wizard
// reads as one cohesive family. Used by both the asterisk-required
// tooltip and the lat/long inline-info tooltip.
function makeThemedTooltipSlotProps(theme, maxWidth = 280) {
  const tone = `color-mix(in srgb, ${theme.palette.primary.main} 22%, ${theme.palette.background.paper})`;
  return {
    tooltip: {
      sx: {
        bgcolor: tone,
        color: theme.palette.common.white,
        border: `1px solid ${alpha(theme.palette.primary.main, 0.55)}`,
        fontSize: '0.74rem',
        fontWeight: 500,
        lineHeight: 1.55,
        maxWidth,
        px: 1.5,
        py: 1.1,
        borderRadius: 1.25,
        boxShadow: `0 6px 18px ${alpha(theme.palette.common.black, 0.4)}`
      }
    },
    arrow: { sx: { color: tone } }
  };
}

// Reusable tooltip body for the "why is this field marked *?" explainer.
// Defined as a constant rather than inline so the FieldLabel's tooltip
// stays compact and the prose stays editable in one place.
const REQUIRED_TOOLTIP_TEXT =
  'Required because the model leans on this input heavily AND most training rows contained a value. ' +
  'Crop, Season, State, County, and Total N all meet that bar — they’re strong signals the model expects every prediction to include.';

// Reusable tooltip body for the lat/long inline-info icon. Mirrors the
// text that used to live as a callout box in the side panel — moved
// here so the user discovers the explanation in context (hovering the
// info icon next to the actual mechanic) rather than having to open
// the side panel to find it.
const LATLONG_TOOLTIP_TEXT =
  'Latitude and longitude are the model’s second-strongest signal, but most growers don’t know their field’s coordinates offhand. ' +
  'The backend fills them in from the centroid of the county you pick. ' +
  'The prediction response reports a coordinates_source field so you can verify whether the prediction used your county’s centroid or user-supplied coordinates.';

// Field label component — small uppercase caption tinted to the primary
// family, mirroring the InfoField pattern in ModelSelectionStep so the
// two wizard steps read as one cohesive form. Required fields get a
// red asterisk after the text; the asterisk doubles as a hover affordance
// that surfaces the "why required" explanation via a themed tooltip.
function FieldLabel({ text, required = false }) {
  const theme = useTheme();
  return (
    <Typography
      sx={{
        color: alpha(theme.palette.primary.light, 0.85),
        fontSize: '0.7rem',
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        lineHeight: 1.3
      }}
    >
      {text}
      {required ? (
        // The asterisk is wrapped in a Tooltip and given tabIndex=0 so the
        // explanation is reachable by both mouse hover and keyboard focus.
        // Using `component="span"` with role="img" + aria-label gives
        // screen readers "required" as a label, which is more useful than
        // the bare "*" glyph.
        <Tooltip
          arrow
          placement="top"
          title={REQUIRED_TOOLTIP_TEXT}
          slotProps={makeThemedTooltipSlotProps(theme, 320)}
        >
          <Box
            component="span"
            tabIndex={0}
            role="img"
            aria-label="Required field — hover for details"
            sx={{
              color: theme.palette.error.light,
              ml: 0.4,
              fontSize: '0.85rem',
              cursor: 'help',
              transition: 'color 0.15s ease',
              outline: 'none',
              '&:hover, &:focus-visible': {
                color: theme.palette.error.main
              }
            }}
          >
            *
          </Box>
        </Tooltip>
      ) : null}
    </Typography>
  );
}

// Section header — slightly more prominent than the field labels so the
// form parses as discrete groups (Crop & Variety / Field Inputs / Time
// & Location) rather than 9 unrelated text fields.
function SectionHeader({ children }) {
  const theme = useTheme();
  return (
    <Typography
      sx={{
        color: alpha(theme.palette.primary.light, 0.95),
        fontSize: '0.8rem',
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase'
      }}
    >
      {children}
    </Typography>
  );
}

export default function PredictionInputStep({
  formValues,
  onChange,
  onPrefill,
  crops,
  varieties,
  seasons,
  states,
  counties,
  validationErrors = {},
  // Coverage payload from /api/v1/models/coverage. When present, drives the
  // numeric-field guidance (typical range hints, soft out-of-range warnings,
  // required-because-trainable cues) and the section-header coverage scope
  // captions. Null is fine — the form degrades gracefully back to its
  // pre-coverage behavior.
  coverage = null
}) {
  const theme = useTheme();
  const hasCrop = Boolean(formValues.crop);
  // Hide the "Unknown" sentinel from the variety dropdown. It's a real
  // value in the training data (rows whose variety wasn't recorded) but
  // showing it as a selectable option in the wizard is confusing — the
  // user would pick it intending to mean "I don't know" while the model
  // would interpret it as the specific category it was trained on under
  // that name. Filtering it out (case-insensitive) means the user
  // simply leaves the dropdown blank when they don't know the variety;
  // the predictor already handles missing variety correctly (73% of
  // training rows had it blank).
  const displayedVarieties = varieties.filter(
    (v) => String(v || '').trim().toLowerCase() !== 'unknown',
  );
  const hasVarietiesForCrop = displayedVarieties.length > 0;
  const isVarietyDisabled = !hasCrop || !hasVarietiesForCrop;

  // Per-form-field metadata derived from coverage.numeric_ranges. We expose
  // p5 / p95 (the typical-range shown to the user as a helper hint), absolute
  // min / max (the hard input bounds), and a `required` flag indicating the
  // model was trained on rows where this column was non-null and therefore
  // can't tolerate a blank value from the form.
  const numericMeta = (coverage && coverage.numeric_ranges) || {};
  const getMeta = (formField) => numericMeta[formField] || null;

  // Helper-text label under each numeric input. Returns one of:
  //   - "Typical: X – Y" for the common case (training data has variation
  //     across the percentile band)
  //   - "Most growers leave at 0..." when the median is 0 but some
  //     growers do apply it (long-tail fertilizers like DAP)
  //   - "Leave blank unless you applied this..." when p95 itself is 0
  //     (the feature is essentially binary — used or not)
  //   - undefined when coverage isn't available, so the form doesn't
  //     show placeholder helper text
  const typicalRangeText = (meta) => {
    if (!meta) return undefined;
    if (meta.p95 <= 0) {
      return 'Leave blank unless you applied this — most growers don’t.';
    }
    if (meta.p50 <= 0) {
      return `Most growers leave at 0. When applied, typical: up to ${meta.p95}`;
    }
    return `Typical: ${meta.p5} – ${meta.p95}`;
  };

  // Soft out-of-range check. Returns true only when the user has actually
  // typed something and the value falls outside the p5–p95 band derived
  // from training. We don't block submission; we just paint the helper
  // text yellow so the user knows the model is extrapolating.
  const isOutOfTypicalRange = (value, meta) => {
    if (!meta) return false;
    if (value === '' || value === null || value === undefined) return false;
    const n = Number(value);
    if (!Number.isFinite(n)) return false;
    return n < meta.p5 || n > meta.p95;
  };

  // Reusable renderer for the numeric Field Inputs section. Folds the meta-
  // lookup + range hint + soft warning + required-asterisk wiring into one
  // place so each field below stays a tight one-liner. Returns the JSX for
  // a single labeled TextField inside its Grid cell — or null when coverage
  // is loaded and the field has no training signal (e.g., water_applied_mm
  // is 100% null in the wheat training set, so the model can't use it and
  // the form shouldn't ask for it).
  const renderNumericField = ({ name, label, gridProps = { xs: 12, sm: 6, md: 4 } }) => {
    const meta = getMeta(name);
    // Coverage is the source of truth for which fields the active model
    // actually uses. If coverage loaded but didn't surface this field
    // (because the training column was entirely null or absent), drop it
    // from the form entirely. When coverage is null (legacy fallback) we
    // render every field as before so nothing silently disappears for
    // models without a coverage.json yet.
    if (coverage && !meta) return null;
    const isRequired = Boolean(meta && meta.required);
    const outOfRange = isOutOfTypicalRange(formValues[name], meta);
    const helperRange = typicalRangeText(meta);
    const helperText = outOfRange
      ? `Outside typical range (${meta.p5} – ${meta.p95}). The model is extrapolating; prediction may be less reliable.`
      : helperRange;
    const inputProps = {};
    if (meta) {
      // Lower bound: clamp at 0 for fertilizer / acres / water (negative
      // values are meaningless). Upper bound: use the training max — a
      // hard ceiling above which the model definitely can't be trusted.
      inputProps.min = Math.max(0, meta.min);
      inputProps.max = meta.max;
      inputProps.step = 'any';
    }
    // Placeholder distinguishes "blank = I don't know" from "user typed 0".
    // Required fields prompt the user to enter a value; optional fields
    // explicitly say it's fine to leave blank — this is the bit that
    // tells users "0 is a real value, blank means unknown." The old
    // "0.00" placeholder was misleading because it looked like a default,
    // which collided with typical-range hints (e.g. acres p5–p95 = 5.75–189.3).
    const fieldPlaceholder = isRequired ? 'Enter a value' : 'Leave blank if unknown';
    return (
      <Grid size={gridProps} key={name}>
        <Stack spacing={0.85}>
          <FieldLabel text={label} required={isRequired} />
          <TextField
            fullWidth
            type="number"
            name={name}
            placeholder={fieldPlaceholder}
            value={formValues[name]}
            onChange={onChange}
            inputProps={inputProps}
            helperText={helperText || undefined}
            sx={{
              ...themedFieldSx,
              // Soft warning paints the helper-text in the theme's warning
              // color when the value sits outside the typical band. The
              // input itself stays unstyled so it doesn't read as an error.
              ...(outOfRange
                ? {
                    '& .MuiFormHelperText-root': {
                      color: theme.palette.warning.light,
                      fontWeight: 600
                    }
                  }
                : {})
            }}
          />
        </Stack>
      </Grid>
    );
  };

  // Section-header coverage scope captions — small "5 states, 90 counties"
  // text under each SectionHeader so the user sees the model's trained
  // envelope explicitly rather than wondering why the dropdowns are short.
  const cropScopeText = (() => {
    if (!coverage) return null;
    const nCrops = Array.isArray(coverage.crops) ? coverage.crops.length : 0;
    const nVarieties = coverage._summary?.n_varieties ?? Object.values(coverage.varieties_by_crop || {})
      .reduce((acc, list) => acc + (Array.isArray(list) ? list.length : 0), 0);
    if (!nCrops && !nVarieties) return null;
    return `Model trained on ${nCrops} crop type${nCrops === 1 ? '' : 's'} · ${nVarieties} varieties`;
  })();

  const locationScopeText = (() => {
    if (!coverage) return null;
    const nStates = Array.isArray(coverage.states) ? coverage.states.length : 0;
    const nCounties = coverage._summary?.n_counties_total ?? Object.values(coverage.counties_by_state || {})
      .reduce((acc, list) => acc + (Array.isArray(list) ? list.length : 0), 0);
    const nSeasons = Array.isArray(coverage.seasons) ? coverage.seasons.length : 0;
    if (!nStates && !nCounties && !nSeasons) return null;
    return `Supported: ${nStates} state${nStates === 1 ? '' : 's'} · ${nCounties} count${nCounties === 1 ? 'y' : 'ies'} · ${nSeasons} season${nSeasons === 1 ? '' : 's'}`;
  })();

  // Saved prediction runs the user can prefill from. Same /predict/history
  // endpoint Analytics uses; pulled to a generous 50 entries so users with a
  // moderate run history see most of their work without paging. Failures are
  // silent — the banner just hides when the list is empty, so a broken
  // endpoint never blocks the manual form path.
  const [prefillRuns, setPrefillRuns] = useState([]);
  const [selectedPrefillId, setSelectedPrefillId] = useState('');
  const [prefillLoadError, setPrefillLoadError] = useState('');

  // Feature-importance side panel — opened via the button in the Crop &
  // Variety card header. Rendered as a fixed-position floating Paper
  // (not a Popover or Drawer), so it stays open and doesn't trap focus
  // or block clicks on the form behind it. The user can keep typing
  // in the form while reading the panel — see the panel render block
  // below for the non-modal positioning details.
  const [featureInfoOpen, setFeatureInfoOpen] = useState(false);

  // First-visit attention treatment for the "How Inputs Affect
  // Predictions" button. Defaults to false on every mount of this
  // component (component-local state, not persisted), so:
  //   - User lands on the Prediction Inputs step → button pulses + brighter
  //   - User clicks the button → state flips to true → pulse/brightness removed
  //   - User navigates away, then back → component remounts → pulses again
  // This intentionally doesn't persist across sessions: the goal is to
  // draw the eye to a useful control on first encounter without nagging
  // the user every time they revisit a working session.
  const [hasOpenedPanel, setHasOpenedPanel] = useState(false);

  // Collapsible "Advanced" section in the Field Inputs card. Hides
  // detailed fertilizer-breakdown inputs (per-fertilizer N/P amounts
  // and Total K) behind a toggle, so casual users see a compact form
  // and power users with detailed records can opt in. Closed by default.
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (typeof onPrefill !== 'function') return undefined;
    const controller = new AbortController();
    const loadHistory = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/predict/history?limit=50&page=1`, { signal: controller.signal });
        if (!response.ok) {
          setPrefillLoadError('Could not load previous runs.');
          return;
        }
        const payload = await response.json();
        const rows = Array.isArray(payload) ? payload : [];
        // Map the API row into the shape this component needs. We pull
        // canonical column names first and fall back to the request payload
        // so older rows missing the flat columns still resolve. Numeric
        // fields are coerced into strings (the form's controlled inputs
        // hold strings, not numbers) via numToFormString.
        const normalized = rows
          .map((row) => {
            const req = row.request_payload || {};
            return {
              id: row.prediction_run_id,
              createdAt: row.created_at,
              crop: row.crop || req.crop || '',
              variety: row.variety || req.variety || '',
              season: row.season ?? req.season ?? '',
              state: row.state || req.state || '',
              county: row.county || req.county || '',
              acres: numToFormString(row.acres ?? req.acres),
              totalN: numToFormString(row.totalN_per_ac ?? req.totalN_per_ac),
              totalP: numToFormString(row.totalP_per_ac ?? req.totalP_per_ac),
              totalK: numToFormString(row.totalK_per_ac ?? req.totalK_per_ac),
              waterApplied: numToFormString(row.water_applied_mm ?? req.water_applied_mm)
            };
          })
          .filter((row) => row.id != null);
        setPrefillRuns(normalized);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setPrefillLoadError(error.message || 'Could not load previous runs.');
        }
      }
    };
    loadHistory();
    return () => controller.abort();
  }, [onPrefill]);

  const selectedPrefillRun = useMemo(
    () => prefillRuns.find((r) => String(r.id) === String(selectedPrefillId)) || null,
    [prefillRuns, selectedPrefillId]
  );

  const handleApplyPrefill = () => {
    if (!selectedPrefillRun || typeof onPrefill !== 'function') return;
    const { id: _id, createdAt: _createdAt, ...patch } = selectedPrefillRun;
    onPrefill(patch);
  };

  // Surface tokens matched to the Overview tab's metric-tile family:
  // bright primary-tinted bg with a half-alpha primary border + soft
  // drop shadow. Previously this step used a darker `color-mix(8%
  // primary, paper)` surface which read as muted navy and felt visually
  // disconnected from the rest of the page. Aligning to the Overview
  // tile values makes every primary-blue surface in the app one family.
  const cardSurface = alpha(theme.palette.primary.main, 0.18);
  const cardBorder = alpha(theme.palette.primary.main, 0.5);
  const cardShadow = `0 4px 14px ${alpha(theme.palette.common.black, 0.35)}`;
  // Themed dropdown menu surface — uses the slightly darker color-mix
  // tone so opened menus are visibly distinct from the bright Paper
  // they sit over. Matches the dropdown styling on FieldMapPreview's
  // hover popup and the FieldTable's column-header area.
  const menuSurface = `color-mix(in srgb, ${theme.palette.primary.main} 14%, ${theme.palette.background.paper})`;
  const sectionDivider = alpha(theme.palette.primary.main, 0.28);
  const headingColor = theme.palette.common.white;
  const labelMuted = alpha(theme.palette.common.white, 0.65);

  // Themed TextField styling — primary-tinted bg, primary-alpha borders,
  // primary on focus + hover. Mirrors the FieldTable filter inputs and
  // the wizard's other styled inputs so any text input on the page
  // looks like it belongs to the same product surface.
  const themedFieldSx = {
    '& .MuiOutlinedInput-root': {
      // Light, neutral-tinted fill — uses a low-alpha WHITE overlay
      // (not primary-tinted) so the inputs visually lift off the
      // brighter primary-blue Paper around them. Previously the
      // inputs were primary-tinted at alpha 0.08 which read as
      // *darker* than the Paper (less primary tint than 0.18 = less
      // blue = darker rendered color in dark mode); switching to a
      // white tint makes them clearly lighter / more "raised."
      bgcolor: alpha(theme.palette.common.white, 0.08),
      color: theme.palette.common.white,
      fontSize: '0.92rem',
      borderRadius: 1.25,
      transition: 'background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease',
      '& fieldset': { borderColor: alpha(theme.palette.primary.light, 0.35) },
      '&:hover': { bgcolor: alpha(theme.palette.common.white, 0.12) },
      '&:hover fieldset': { borderColor: alpha(theme.palette.primary.light, 0.6) },
      '&.Mui-focused': {
        bgcolor: alpha(theme.palette.common.white, 0.14)
      },
      '&.Mui-focused fieldset': {
        borderColor: theme.palette.primary.light,
        borderWidth: 1.5,
        boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.22)}`
      },
      '&.Mui-disabled': {
        bgcolor: alpha(theme.palette.common.white, 0.04)
      },
      '&.Mui-disabled fieldset': { borderColor: alpha(theme.palette.primary.main, 0.16) },
      '&.Mui-error fieldset': { borderColor: theme.palette.error.main }
    },
    '& .MuiInputBase-input': {
      // Number-input arrow controls hidden in webkit and firefox so the
      // numeric fields read as clean text inputs (matching the rest of
      // the form's pill-style geometry).
      '&[type=number]': {
        MozAppearance: 'textfield'
      },
      '&[type=number]::-webkit-outer-spin-button, &[type=number]::-webkit-inner-spin-button': {
        WebkitAppearance: 'none',
        margin: 0
      }
    },
    // Placeholder text is white at full strength when the field is
    // editable — reads as a clear hint instead of the faded grey
    // browser default. `opacity: 1` overrides Firefox's built-in 0.54
    // dimming. The disabled-state override below pulls it back to
    // muted grey so a non-editable field still looks non-editable.
    '& .MuiInputBase-input::placeholder': {
      color: theme.palette.common.white,
      opacity: 1
    },
    // Disabled state — input value AND placeholder both render in the
    // theme's muted-grey palette. We have to set BOTH `color` and
    // `WebkitTextFillColor`: Chrome/Safari paint disabled-input text
    // via WebkitTextFillColor regardless of the `color` property, so
    // omitting it would leave the value at full white while the
    // placeholder dimmed (inconsistent).
    '& .MuiInputBase-input.Mui-disabled': {
      WebkitTextFillColor: alpha(theme.palette.common.white, 0.45),
      color: alpha(theme.palette.common.white, 0.45)
    },
    '& .MuiInputBase-input.Mui-disabled::placeholder': {
      color: alpha(theme.palette.common.white, 0.4),
      WebkitTextFillColor: alpha(theme.palette.common.white, 0.4),
      opacity: 1
    },
    // Select-flavored fields (Crop / Variety / Season / State /
    // County) render their empty-state hint via `renderValue` rather
    // than a real HTML placeholder, so the rule above doesn't reach
    // it. This rule disables the select's display element when the
    // wrapping FormControl is disabled — same muted-grey result.
    '& .MuiInputBase-root.Mui-disabled .MuiSelect-select': {
      WebkitTextFillColor: alpha(theme.palette.common.white, 0.45),
      color: alpha(theme.palette.common.white, 0.45)
    },
    '& .MuiSelect-icon': { color: alpha(theme.palette.primary.light, 0.75) },
    '& .MuiFormHelperText-root': {
      color: alpha(theme.palette.common.white, 0.55),
      fontSize: '0.72rem',
      mx: 0.25
    },
    '& .MuiFormHelperText-root.Mui-error': { color: theme.palette.error.light }
  };

  // Themed dropdown menu so opened menus pick up the same primary-on-
  // paper surface as the rest of the page. Without this, MUI defaults
  // render a plain gray panel that breaks the visual continuity.
  const themedSelectMenuProps = {
    MenuProps: {
      slotProps: {
        paper: {
          sx: {
            bgcolor: menuSurface,
            border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
            backgroundImage: 'none',
            mt: 0.5,
            maxHeight: 320,
            '& .MuiMenuItem-root': {
              color: alpha(theme.palette.common.white, 0.9),
              fontSize: '0.9rem',
              minHeight: 36,
              '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.18) },
              '&.Mui-selected': {
                bgcolor: alpha(theme.palette.primary.main, 0.32),
                '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.42) }
              }
            }
          }
        }
      }
    }
  };

  return (
    <Stack spacing={2.75}>
      {/* Header — matches the heading typography in ModelSelectionStep
          so both wizard steps share the same opening rhythm. */}
      <Stack spacing={0.5}>
        <Typography variant="h4" sx={{ fontWeight: 700, color: headingColor, lineHeight: 1.2 }}>
          Enter Prediction Inputs
        </Typography>
        <Typography sx={{ color: labelMuted, fontSize: '0.95rem', lineHeight: 1.55 }}>
          Provide the agronomic and location values used to generate a yield prediction. Fields marked with{' '}
          <Box component="span" sx={{ color: theme.palette.error.light, fontWeight: 700 }}>*</Box> are required because
          the model relies on them heavily — see &ldquo;{FEATURE_PANEL_BUTTON_LABEL}&rdquo; for the full breakdown of
          which inputs move the prediction and by how much.
        </Typography>
      </Stack>

      {/* Prefill banner — optional shortcut that lets the user jump-start
          the form with a previous run's values. Hidden when no runs are
          available so the form path is unaffected for first-time users. */}
      {prefillRuns.length > 0 ? (
        <Paper
          variant="outlined"
          sx={{
            // Slightly cooler tint than the main form card so the banner
            // reads as a secondary affordance, not a duplicate primary panel.
            bgcolor: alpha(theme.palette.primary.main, 0.14),
            borderColor: alpha(theme.palette.primary.main, 0.45),
            borderRadius: 2,
            backgroundImage: 'none',
            boxShadow: cardShadow,
            overflow: 'hidden'
          }}
        >
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={{ xs: 1.5, md: 2 }}
            sx={{
              alignItems: { xs: 'stretch', md: 'center' },
              px: { xs: 2, md: 2.5 },
              py: 1.75
            }}
          >
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flex: 1, minWidth: 0 }}>
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: alpha(theme.palette.primary.main, 0.25),
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.55)}`,
                  color: theme.palette.primary.light,
                  fontSize: '1.05rem',
                  flexShrink: 0
                }}
              >
                <HistoryOutlined />
              </Box>
              <Stack spacing={0.15} sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
                  <Typography
                    sx={{
                      color: theme.palette.common.white,
                      fontWeight: 700,
                      fontSize: '0.92rem',
                      letterSpacing: '0.02em'
                    }}
                  >
                    Prefill from a previous run
                  </Typography>
                  <Tooltip
                    arrow
                    placement="top"
                    title="Copies crop, variety, season, location, and applied inputs from the selected run into the form below. You can still edit any field after prefilling."
                    slotProps={{
                      tooltip: {
                        sx: {
                          bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})`,
                          color: theme.palette.common.white,
                          border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
                          fontSize: '0.74rem',
                          fontWeight: 500,
                          maxWidth: 300,
                          px: 1.25,
                          py: 0.85,
                          borderRadius: 1.25
                        }
                      },
                      arrow: {
                        sx: { color: `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})` }
                      }
                    }}
                  >
                    <Box
                      component="span"
                      tabIndex={0}
                      aria-label="About prefilling"
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        cursor: 'help',
                        color: alpha(theme.palette.primary.light, 0.7),
                        fontSize: '0.85rem',
                        '&:hover, &:focus-visible': { color: theme.palette.primary.light, outline: 'none' }
                      }}
                    >
                      <InfoCircleOutlined />
                    </Box>
                  </Tooltip>
                </Stack>
                <Typography
                  sx={{
                    color: alpha(theme.palette.common.white, 0.6),
                    fontSize: '0.78rem',
                    fontWeight: 500,
                    lineHeight: 1.4
                  }}
                >
                  Optional — pick a saved run to copy its inputs into the form.
                </Typography>
              </Stack>
            </Stack>

            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ width: { xs: '100%', md: 'auto' }, alignItems: { xs: 'stretch', sm: 'center' } }}
            >
              <TextField
                select
                size="small"
                value={selectedPrefillId}
                onChange={(event) => setSelectedPrefillId(event.target.value)}
                sx={{
                  ...themedFieldSx,
                  minWidth: { xs: '100%', sm: 320 },
                  '& .MuiOutlinedInput-root': {
                    ...themedFieldSx['& .MuiOutlinedInput-root'],
                    fontSize: '0.85rem'
                  }
                }}
                SelectProps={{
                  displayEmpty: true,
                  renderValue: (selected) => {
                    if (!selected) {
                      return (
                        <Box component="span" sx={{ color: alpha(theme.palette.common.white, 0.55) }}>
                          Choose a previous run…
                        </Box>
                      );
                    }
                    const run = prefillRuns.find((r) => String(r.id) === String(selected));
                    if (!run) return String(selected);
                    return `#${run.id} · ${summarizePrefillRun(run)}`;
                  },
                  ...themedSelectMenuProps
                }}
              >
                <MenuItem value="" disabled>
                  Choose a previous run…
                </MenuItem>
                {prefillRuns.map((run) => (
                  <MenuItem key={run.id} value={run.id}>
                    <Stack spacing={0.15} sx={{ minWidth: 0 }}>
                      <Typography
                        sx={{
                          color: theme.palette.common.white,
                          fontWeight: 700,
                          fontSize: '0.85rem',
                          lineHeight: 1.25
                        }}
                      >
                        Run #{run.id}
                      </Typography>
                      <Typography
                        sx={{
                          color: alpha(theme.palette.common.white, 0.7),
                          fontSize: '0.76rem',
                          fontWeight: 500,
                          lineHeight: 1.3,
                          whiteSpace: 'normal'
                        }}
                      >
                        {summarizePrefillRun(run) || '—'}
                      </Typography>
                    </Stack>
                  </MenuItem>
                ))}
              </TextField>
              <Button
                disabled={!selectedPrefillRun}
                onClick={handleApplyPrefill}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  letterSpacing: '0.01em',
                  px: 2,
                  py: 0.7,
                  borderRadius: 999,
                  color: alpha(theme.palette.primary.light, 0.95),
                  bgcolor: alpha(theme.palette.primary.main, 0.18),
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.55)}`,
                  transition: 'background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease',
                  whiteSpace: 'nowrap',
                  '&:hover': {
                    color: theme.palette.common.white,
                    bgcolor: alpha(theme.palette.primary.main, 0.32),
                    borderColor: theme.palette.primary.main,
                    boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.18)}`
                  },
                  '&.Mui-disabled': {
                    color: alpha(theme.palette.common.white, 0.4),
                    bgcolor: alpha(theme.palette.primary.main, 0.08),
                    borderColor: alpha(theme.palette.primary.main, 0.2)
                  }
                }}
              >
                Prefill
              </Button>
            </Stack>
          </Stack>
          {prefillLoadError ? (
            <Box
              sx={{
                px: { xs: 2, md: 2.5 },
                py: 1,
                borderTop: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                bgcolor: alpha(theme.palette.warning.main, 0.06)
              }}
            >
              <Typography sx={{ color: theme.palette.warning.light, fontSize: '0.75rem' }}>
                {prefillLoadError}
              </Typography>
            </Box>
          ) : null}
        </Paper>
      ) : null}

      <Paper
        variant="outlined"
        sx={{
          bgcolor: cardSurface,
          borderColor: cardBorder,
          borderRadius: 2,
          p: { xs: 2.25, md: 3 },
          backgroundImage: 'none',
          boxShadow: cardShadow
        }}
      >
        <Stack spacing={3}>
          {/* Section 1 — Crop & Variety. Both required, both drive the
              prediction's reference distribution, so they lead the form.
              Coverage scope caption beneath the header makes the model's
              trained envelope visible — users see why the variety dropdown
              is "short" rather than guessing the form is broken. */}
          <Stack spacing={1.75}>
            {/* Section header + Feature Importance trigger. The button is
                top-right of the Crop & Variety card so it's the first
                thing the user sees on this step — they can pop the panel
                before they type anything and reference it throughout. */}
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              spacing={1}
            >
              <SectionHeader>Crop & Variety</SectionHeader>
              <Button
                size="small"
                onClick={() => {
                  // Flip the open state AND mark the panel as seen for
                  // this mount. Once seen, the pulse animation + brighter
                  // surface treatment go away; on remount they come back.
                  setFeatureInfoOpen((prev) => !prev);
                  setHasOpenedPanel(true);
                }}
                startIcon={<BarChartOutlined style={{ fontSize: 12 }} />}
                sx={{
                  textTransform: 'none',
                  fontWeight: 600,
                  fontSize: '0.72rem',
                  letterSpacing: '0.02em',
                  px: 1.25,
                  py: 0.4,
                  borderRadius: 999,
                  // Mirrors the Prefill button's surface treatment so the
                  // two pill-shaped affordances in the form read as one
                  // family. featureInfoOpen flips it to a "pressed" look
                  // so the user sees the panel toggle is active.
                  //
                  // First-visit attention treatment: until the user has
                  // opened the panel at least once during this mount, the
                  // button gets a brighter base surface plus a pulsing
                  // primary-tinted glow that draws the eye without being
                  // obnoxious. After the first click, the styling reverts
                  // to the regular pill so the affordance doesn't keep
                  // nagging. State is component-local — fresh mount
                  // (e.g., user revisits the page) restores the pulse.
                  color: featureInfoOpen
                    ? theme.palette.common.white
                    : !hasOpenedPanel
                      ? theme.palette.common.white
                      : alpha(theme.palette.primary.light, 0.95),
                  bgcolor: featureInfoOpen
                    ? alpha(theme.palette.primary.main, 0.32)
                    : !hasOpenedPanel
                      ? alpha(theme.palette.primary.main, 0.35)
                      : alpha(theme.palette.primary.main, 0.18),
                  border: `1px solid ${
                    featureInfoOpen
                      ? theme.palette.primary.main
                      : !hasOpenedPanel
                        ? theme.palette.primary.light
                        : alpha(theme.palette.primary.main, 0.55)
                  }`,
                  transition: 'background 0.18s ease, color 0.18s ease, border-color 0.18s ease',
                  whiteSpace: 'nowrap',
                  // Pulse glow ring — radiates out from the button on a
                  // 2s loop, fading from a solid 8px-radius primary-light
                  // halo to fully transparent. Kept gentle (peak alpha
                  // ~0.55) so it feels like a "look here" cue rather than
                  // a warning. Disabled the moment the user clicks the
                  // button (or hovers, since hover gives them the same
                  // affordance visually).
                  ...(!hasOpenedPanel && !featureInfoOpen
                    ? {
                        animation: 'panelButtonPulse 2.2s ease-in-out infinite',
                        '@keyframes panelButtonPulse': {
                          '0%, 100%': {
                            boxShadow: `0 0 0 0 ${alpha(theme.palette.primary.light, 0.55)}`
                          },
                          '50%': {
                            boxShadow: `0 0 0 8px ${alpha(theme.palette.primary.light, 0)}`
                          }
                        }
                      }
                    : {}),
                  '&:hover': {
                    color: theme.palette.common.white,
                    bgcolor: alpha(theme.palette.primary.main, 0.32),
                    borderColor: theme.palette.primary.main,
                    // Pause the pulse on hover so the user has a stable
                    // surface to click without flicker.
                    animation: 'none'
                  }
                }}
                aria-expanded={featureInfoOpen}
                aria-controls="feature-importance-panel"
              >
                {FEATURE_PANEL_BUTTON_LABEL}
              </Button>
            </Stack>
            {cropScopeText ? (
              <Typography
                sx={{
                  color: alpha(theme.palette.common.white, 0.55),
                  fontSize: '0.72rem',
                  fontWeight: 500,
                  letterSpacing: '0.02em',
                  mt: -0.75
                }}
              >
                {cropScopeText}
              </Typography>
            ) : null}
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Stack spacing={0.85}>
                  <FieldLabel text="Crop" required />
                  <TextField
                    select
                    fullWidth
                    name="crop"
                    value={formValues.crop}
                    onChange={onChange}
                    error={Boolean(validationErrors.crop)}
                    helperText={validationErrors.crop ? 'Crop is required.' : undefined}
                    sx={themedFieldSx}
                    SelectProps={{
                      displayEmpty: true,
                      renderValue: (selected) => (selected ? formatCropName(selected) : 'Select a crop…'),
                      ...themedSelectMenuProps
                    }}
                  >
                    <MenuItem value="" disabled>
                      Select a crop…
                    </MenuItem>
                    {crops.map((crop) => (
                      <MenuItem key={crop} value={crop}>
                        {formatCropName(crop)}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <Stack spacing={0.85}>
                  {/* Variety is optional — 73% of training rows had no
                      variety listed, so requiring it would be stricter
                      than the model's actual data history. The dropdown
                      is still scoped to varieties the model has seen so
                      a power user with detailed records can pick one. */}
                  <FieldLabel text="Variety" />
                  <TextField
                    select
                    fullWidth
                    name="variety"
                    value={formValues.variety}
                    onChange={onChange}
                    disabled={isVarietyDisabled}
                    helperText={
                      hasCrop && !hasVarietiesForCrop
                        ? 'No variety available for selected crop'
                        : undefined
                    }
                    sx={themedFieldSx}
                    SelectProps={{
                      displayEmpty: true,
                      renderValue: (selected) => selected || 'Select a variety…',
                      ...themedSelectMenuProps
                    }}
                  >
                    <MenuItem value="" disabled>
                      Select a variety…
                    </MenuItem>
                    {hasCrop && !hasVarietiesForCrop ? (
                      <MenuItem value="" disabled>
                        No variety available for selected crop
                      </MenuItem>
                    ) : null}
                    {displayedVarieties.map((variety) => (
                      <MenuItem key={variety} value={variety}>
                        {variety}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
              </Grid>
            </Grid>
          </Stack>

          <Divider sx={{ borderColor: sectionDivider }} />

          {/* Section 2 — Field Inputs. Top-level numerics that most
              users will fill in: nutrient totals, area. Required fields
              get an asterisk (the panel explains why). Detailed
              fertilizer breakdowns and low-signal inputs (totalK, etc.)
              live under the Advanced toggle below so casual users see
              a compact form. */}
          <Stack spacing={1.75}>
            <SectionHeader>Field Inputs</SectionHeader>
            <Grid container spacing={2}>
              {renderNumericField({ name: 'totalN', label: 'Total N (lb/ac)' })}
              {renderNumericField({ name: 'totalP', label: 'Total P (lb/ac)' })}
              {renderNumericField({ name: 'acres', label: 'Acres' })}
              {renderNumericField({ name: 'waterApplied', label: 'Water Applied (mm)' })}
            </Grid>

            {/* Advanced toggle + collapsible body. The toggle is a
                full-width pill that matches the Prefill/panel button
                family. When open, the chevron rotates and the section
                slides down to reveal Total K + per-fertilizer N and P
                breakdowns. All Advanced fields are optional — leaving
                them blank tells the model "no detailed info available"
                and it falls back to the totals. */}
            <Button
              fullWidth
              onClick={() => setAdvancedOpen((prev) => !prev)}
              endIcon={
                advancedOpen ? (
                  <UpOutlined style={{ fontSize: 10 }} />
                ) : (
                  <DownOutlined style={{ fontSize: 10 }} />
                )
              }
              aria-expanded={advancedOpen}
              aria-controls="advanced-field-inputs"
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '0.78rem',
                letterSpacing: '0.04em',
                px: 1.5,
                py: 0.75,
                mt: 0.5,
                borderRadius: 1.25,
                justifyContent: 'space-between',
                color: alpha(theme.palette.primary.light, 0.95),
                bgcolor: alpha(theme.palette.primary.main, 0.12),
                border: `1px dashed ${alpha(theme.palette.primary.main, 0.45)}`,
                transition: 'background 0.18s ease, border-color 0.18s ease, color 0.18s ease',
                '&:hover': {
                  color: theme.palette.common.white,
                  bgcolor: alpha(theme.palette.primary.main, 0.22),
                  borderColor: alpha(theme.palette.primary.main, 0.7),
                  borderStyle: 'solid'
                }
              }}
            >
              {advancedOpen ? 'Hide Advanced Inputs' : 'Show Advanced Inputs (fertilizer breakdown, total K)'}
            </Button>
            <Collapse in={advancedOpen} unmountOnExit timeout={250}>
              <Box id="advanced-field-inputs" sx={{ pt: 0.5 }}>
                <Typography
                  sx={{
                    color: alpha(theme.palette.common.white, 0.6),
                    fontSize: '0.74rem',
                    fontWeight: 500,
                    lineHeight: 1.55,
                    mb: 1.5
                  }}
                >
                  All Advanced inputs are optional. If you don&apos;t track fertilizer applications by
                  source, leave these blank — the model uses your Total N / Total P above as a
                  fallback. Filling them in gives the model more detail and can sharpen the prediction
                  for growers who apply DAP, anhydrous ammonia, or UAN solution.
                </Typography>
                <Grid container spacing={2}>
                  {renderNumericField({ name: 'totalK', label: 'Total K (lb/ac)' })}
                  {renderNumericField({ name: 'ammoniaN', label: 'Anhydrous Ammonia (lb-N/ac)' })}
                  {renderNumericField({ name: 'uanN', label: 'UAN Solution (lb-N/ac)' })}
                  {renderNumericField({ name: 'otherN', label: 'Other N (lb-N/ac)' })}
                  {renderNumericField({ name: 'dapN', label: 'DAP — Nitrogen (lb-N/ac)' })}
                  {renderNumericField({ name: 'dapP', label: 'DAP — Phosphorus (lb-P/ac)' })}
                </Grid>
              </Box>
            </Collapse>
          </Stack>

          <Divider sx={{ borderColor: sectionDivider }} />

          {/* Section 3 — Time & Location. Season + geographic context.
              All required: the model uses these to scope its reference
              comparison to the right region/year. Coverage caption tells
              the user the model's geographic / temporal envelope, so a
              short State dropdown reads as "supported states" rather than
              "missing data". */}
          <Stack spacing={1.75}>
            <SectionHeader>Time & Location</SectionHeader>
            {locationScopeText ? (
              <Typography
                sx={{
                  color: alpha(theme.palette.common.white, 0.55),
                  fontSize: '0.72rem',
                  fontWeight: 500,
                  letterSpacing: '0.02em',
                  mt: -0.75
                }}
              >
                {locationScopeText}
              </Typography>
            ) : null}
            {/* lat/long are auto-derived from county centroid on the
                backend. The inline icon-with-tooltip surfaces the
                mechanic in context — the user hovers (or focuses) the
                info icon to learn why they don't see lat/long fields,
                without having to open the side panel. */}
            {coverage ? (
              <Typography
                sx={{
                  color: alpha(theme.palette.primary.light, 0.85),
                  fontSize: '0.72rem',
                  fontWeight: 500,
                  letterSpacing: '0.01em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.6,
                  mt: -0.25
                }}
              >
                <Tooltip
                  arrow
                  placement="top"
                  title={LATLONG_TOOLTIP_TEXT}
                  slotProps={makeThemedTooltipSlotProps(theme, 340)}
                >
                  <Box
                    component="span"
                    tabIndex={0}
                    role="img"
                    aria-label="How latitude and longitude are filled in — hover for details"
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      cursor: 'help',
                      color: alpha(theme.palette.primary.light, 0.85),
                      transition: 'color 0.15s ease',
                      outline: 'none',
                      '&:hover, &:focus-visible': {
                        color: theme.palette.primary.light
                      }
                    }}
                  >
                    <InfoCircleOutlined style={{ fontSize: 12 }} />
                  </Box>
                </Tooltip>
                Latitude and longitude are auto-derived from your county selection.
              </Typography>
            ) : null}
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <Stack spacing={0.85}>
                  <FieldLabel text="Season" required />
                  <TextField
                    select
                    fullWidth
                    name="season"
                    value={formValues.season}
                    onChange={onChange}
                    error={Boolean(validationErrors.season)}
                    helperText={validationErrors.season ? 'Season is required.' : undefined}
                    sx={themedFieldSx}
                    SelectProps={{
                      displayEmpty: true,
                      renderValue: (selected) => selected || 'Select season',
                      ...themedSelectMenuProps
                    }}
                  >
                    <MenuItem value="" disabled>
                      Select season
                    </MenuItem>
                    {seasons.map((season) => (
                      <MenuItem key={season} value={season}>
                        {season}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
              </Grid>

              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <Stack spacing={0.85}>
                  <FieldLabel text="State" required />
                  <TextField
                    select
                    fullWidth
                    name="state"
                    value={formValues.state}
                    onChange={onChange}
                    error={Boolean(validationErrors.state)}
                    helperText={validationErrors.state ? 'State is required.' : undefined}
                    sx={themedFieldSx}
                    SelectProps={{
                      displayEmpty: true,
                      renderValue: (selected) => selected || 'Select state',
                      ...themedSelectMenuProps
                    }}
                  >
                    <MenuItem value="" disabled>
                      Select state
                    </MenuItem>
                    {states.map((state) => (
                      <MenuItem key={state} value={state}>
                        {state}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
              </Grid>

              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <Stack spacing={0.85}>
                  <FieldLabel text="County" required />
                  <TextField
                    select
                    fullWidth
                    name="county"
                    value={formValues.county}
                    onChange={onChange}
                    disabled={!formValues.state}
                    error={Boolean(validationErrors.county)}
                    helperText={
                      validationErrors.county
                        ? 'County is required.'
                        : !formValues.state
                          ? 'Select a state first'
                          : undefined
                    }
                    sx={themedFieldSx}
                    SelectProps={{
                      displayEmpty: true,
                      renderValue: (selected) => selected || 'Select county',
                      ...themedSelectMenuProps
                    }}
                  >
                    <MenuItem value="" disabled>
                      Select county
                    </MenuItem>
                    {counties.map((county) => (
                      <MenuItem key={county} value={county}>
                        {county}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
              </Grid>
            </Grid>
          </Stack>
        </Stack>
      </Paper>

      {/* Feature Importance side panel — fixed-position floating Paper.
          Deliberately NOT a Popover/Modal/Drawer:
            - Popover/Modal close on outside click, which would interrupt
              the user the moment they tab back to the form.
            - Drawer steals focus and pushes content (variant="persistent")
              or covers it with a backdrop (variant="temporary").
          A plain fixed-position Box stays open until the user explicitly
          dismisses it, leaves the form behind it fully interactive, and
          renders above the page chrome via theme.zIndex.appBar - 1.

          On narrow screens (≤ sm) it spans most of the viewport width
          and the user closes it to interact with the form; on wider
          screens it docks to the right with a 420px width so the form
          and the panel are visible side-by-side. */}
      {featureInfoOpen ? (
        <Box
          id="feature-importance-panel"
          role="region"
          aria-label="Model feature importance"
          sx={{
            position: 'fixed',
            top: { xs: 72, md: 96 },
            right: { xs: 12, md: 24 },
            bottom: { xs: 12, md: 24 },
            width: { xs: 'calc(100vw - 24px)', sm: 380, md: 420 },
            maxWidth: 'calc(100vw - 24px)',
            zIndex: theme.zIndex.appBar - 1,
            // Solid primary-tinted surface — uses color-mix instead of an
            // alpha overlay so the panel is fully opaque and the form
            // behind it doesn't bleed through. The tone matches the form
            // card's apparent color (cardSurface = primary @ 0.18 alpha on
            // background.paper) but rendered as a single opaque value so
            // text and bars stay legible regardless of what's behind it.
            bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})`,
            border: `1px solid ${cardBorder}`,
            borderRadius: 2,
            boxShadow: cardShadow,
            overflowY: 'auto',
            backgroundImage: 'none',
            // Custom scrollbar — matches the rest of the app's scroll
            // surfaces (primary-tinted thumb on transparent track).
            '&::-webkit-scrollbar': { width: 8 },
            '&::-webkit-scrollbar-track': { background: 'transparent' },
            '&::-webkit-scrollbar-thumb': {
              background: alpha(theme.palette.primary.main, 0.35),
              borderRadius: 999
            },
            '&::-webkit-scrollbar-thumb:hover': {
              background: alpha(theme.palette.primary.main, 0.55)
            }
          }}
        >
          {/* Sticky header — keeps title + close button visible as the
              user scrolls through the feature list. Backdrop-blur lets
              the underlying bars peek through the header edge for a
              subtle product-y feel. */}
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{
              position: 'sticky',
              top: 0,
              bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 32%, ${theme.palette.background.paper})`,
              backdropFilter: 'blur(8px)',
              px: 2.25,
              py: 1.5,
              borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.35)}`,
              zIndex: 1
            }}
          >
            <Typography
              sx={{
                fontWeight: 700,
                fontSize: '0.98rem',
                color: theme.palette.common.white,
                letterSpacing: '0.01em'
              }}
            >
              {FEATURE_PANEL_TITLE}
            </Typography>
            <IconButton
              size="small"
              onClick={() => setFeatureInfoOpen(false)}
              aria-label="Close feature importance panel"
              sx={{
                color: alpha(theme.palette.common.white, 0.7),
                width: 26,
                height: 26,
                '&:hover': {
                  color: theme.palette.common.white,
                  bgcolor: alpha(theme.palette.primary.main, 0.32)
                }
              }}
            >
              <CloseOutlined style={{ fontSize: 12 }} />
            </IconButton>
          </Stack>

          <Stack spacing={2.75} sx={{ p: 2.25 }}>
            <Typography
              sx={{
                color: alpha(theme.palette.common.white, 0.7),
                fontSize: '0.8rem',
                lineHeight: 1.55
              }}
            >
              Each percentage shows how much that input contributes to the model&apos;s
              prediction — the bars are sized to match. If Acres at{' '}
              <Box component="span" sx={{ color: theme.palette.common.white, fontWeight: 700 }}>
                21.5%
              </Box>, about a fifth of the prediction is driven by your field size
              alone. Keep this panel open while you fill out the form so you can
              see which fields actually move the needle.
            </Typography>

            {/* Strong signal — features that meaningfully move the prediction. */}
            <Stack spacing={1.5}>
              <Typography
                sx={{
                  color: alpha(theme.palette.primary.light, 0.95),
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase'
                }}
              >
                Strong signal
              </Typography>
              <Stack spacing={1.5}>
                {FEATURE_IMPORTANCE_STRONG.map((feat) => (
                  <FeatureImportanceBar
                    key={feat.label}
                    feat={feat}
                    maxImportance={FEATURE_IMPORTANCE_MAX}
                    theme={theme}
                  />
                ))}
              </Stack>
            </Stack>

            <Divider sx={{ borderColor: alpha(theme.palette.primary.main, 0.22) }} />

            {/* Advanced + optional — features the model uses but with
                lower importance, plus the Advanced fertilizer breakdowns
                that live in the form's collapsible section. */}
            <Stack spacing={1.5}>
              <Typography
                sx={{
                  color: alpha(theme.palette.primary.light, 0.95),
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase'
                }}
              >
                Optional &amp; Advanced
              </Typography>
              <Typography
                sx={{
                  color: alpha(theme.palette.common.white, 0.6),
                  fontSize: '0.76rem',
                  lineHeight: 1.5
                }}
              >
                These inputs the model uses lightly. Total K, per-fertilizer N/P
                breakdowns, and Variety are all optional — leaving them blank is fine.
                Filling them in helps the model when you have detailed records.
              </Typography>
              <Stack spacing={1.5}>
                {FEATURE_IMPORTANCE_ADVANCED.map((feat) => (
                  <FeatureImportanceBar
                    key={feat.label}
                    feat={feat}
                    maxImportance={FEATURE_IMPORTANCE_MAX}
                    theme={theme}
                  />
                ))}
              </Stack>
            </Stack>

            <Divider sx={{ borderColor: alpha(theme.palette.primary.main, 0.22) }} />

            {/* Why-required explainer — addresses the "why does this
                field have a *?" question without making the user dig
                through tooltips. */}
            <Box
              sx={{
                p: 1.5,
                borderRadius: 1.25,
                bgcolor: alpha(theme.palette.primary.main, 0.12),
                border: `1px solid ${alpha(theme.palette.primary.main, 0.32)}`
              }}
            >
              <Typography
                sx={{
                  color: alpha(theme.palette.common.white, 0.78),
                  fontSize: '0.74rem',
                  lineHeight: 1.55
                }}
              >
                <Box component="span" sx={{ color: theme.palette.primary.light, fontWeight: 700 }}>
                  Why do some fields have a{' '}
                  <Box component="span" sx={{ color: theme.palette.error.light }}>*</Box>?
                </Box>{' '}
                A field is required when the model leans on it heavily AND most
                training rows contained a value. Crop, Season, State, County, and
                Total N all meet that bar — they&apos;re strong signals the model
                expects every prediction to include. Everything else is optional
                because either the model uses it lightly, or the training data
                often had it blank — meaning the model already knows how to
                handle a missing value.
              </Typography>
            </Box>

            {/* The lat/long callout that used to live here was moved
                to a hover tooltip on the info icon next to the
                "Latitude and longitude are auto-derived…" line in the
                Time & Location section. Putting it in context (next to
                the actual behavior) is more discoverable than burying
                it at the bottom of the side panel. */}
          </Stack>
        </Box>
      ) : null}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Local presentational component: FeatureImportanceBar
// ---------------------------------------------------------------------------
// One row of the side-panel breakdown. Label + numeric importance + a filled
// bar proportional to the model's max-importance feature, plus a small badge
// describing where the value comes from ("You provide this", "Auto-filled
// from your county", etc.). Kept colocated with the parent component because
// it has no reuse elsewhere — promoting it would only add indirection.
function FeatureImportanceBar({ feat, maxImportance, theme }) {
  const ratio = Math.max(0.02, feat.importance / maxImportance);
  const isAutoFilled = feat.badgeTone === 'primary';
  return (
    <Stack spacing={0.5}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline">
        <Typography
          sx={{
            color: theme.palette.common.white,
            fontSize: '0.85rem',
            fontWeight: 600,
            lineHeight: 1.25
          }}
        >
          {feat.label}
        </Typography>
        <Typography
          sx={{
            color: alpha(theme.palette.common.white, 0.6),
            fontSize: '0.72rem',
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {/* Importance values are CatBoost's normalized importance,
              which sums to ~100 across all features in the model — so
              displaying as a percentage is accurate. The "%" makes it
              clear to users that 21.5 means "21.5% of the model's
              total predictive weight comes from this feature". */}
          {feat.importance.toFixed(1)}%
        </Typography>
      </Stack>
      <Box
        sx={{
          height: 6,
          width: '100%',
          borderRadius: 999,
          bgcolor: alpha(theme.palette.common.white, 0.08),
          overflow: 'hidden'
        }}
      >
        <Box
          sx={{
            height: '100%',
            width: `${ratio * 100}%`,
            // Auto-filled features (lat/long) get a slightly different
            // bar treatment — same hue but brighter — so the user can
            // visually distinguish "you control this" from "the system
            // handles this for you" without reading the badge text.
            background: isAutoFilled
              ? `linear-gradient(90deg, ${theme.palette.primary.light}, ${alpha(theme.palette.primary.light, 0.7)})`
              : `linear-gradient(90deg, ${theme.palette.primary.main}, ${alpha(theme.palette.primary.main, 0.7)})`,
            borderRadius: 999,
            transition: 'width 0.25s ease'
          }}
        />
      </Box>
      {feat.badge ? (
        <Typography
          sx={{
            color: isAutoFilled
              ? alpha(theme.palette.primary.light, 0.85)
              : alpha(theme.palette.common.white, 0.55),
            fontSize: '0.7rem',
            fontWeight: 500,
            lineHeight: 1.3
          }}
        >
          {feat.badge}
        </Typography>
      ) : null}
    </Stack>
  );
}
