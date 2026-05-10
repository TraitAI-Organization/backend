import { useEffect, useMemo, useState } from 'react';

import DownOutlined from '@ant-design/icons/DownOutlined';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';

import { alpha, useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import MainCard from 'components/MainCard';
import FieldMapPreview from 'sections/intelligence/crop-studio/FieldMapPreview';
import FieldTable from 'sections/intelligence/crop-studio/FieldTable';
import { formatCropName } from 'utils/cropName';
import {
  getDaysToHarvest,
  getSeasonProgress,
  getWheatStage,
  STATE_HARVEST_DATES,
  STATE_PLANT_DATES
} from 'sections/intelligence/crop-studio/wheatSeasonHelpers';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

// TODO: pull from an auth/user context once that lands. Hardcoded for the
// dev session so the greeting reads as personal. Swap to `user?.firstName`
// (or whatever the eventual user shape provides) when wiring auth in.
const USER_NAME = 'General Mills';

// Time-of-day greeting. Returns a string like "Good morning" / "Good afternoon"
// / "Good evening", or "Working late" past 10pm so the late-night case feels
// acknowledged rather than wrong.
function getTimeOfDayGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 22) return 'Good evening';
  return 'Working late';
}

function MetricTile({ label, value, unit, helper }) {
  const theme = useTheme();
  return (
    <Paper
      variant="outlined"
      sx={{
        position: 'relative',
        overflow: 'hidden',
        p: 2.25,
        height: '100%',
        borderRadius: 2,
        // Match the "Deep Learning" pill palette next to the Field Performance
        // Records title — saturated primary surface with a half-alpha primary
        // border so all summary cards on this page read as a coherent
        // "primary" family alongside the pill.
        bgcolor: alpha(theme.palette.primary.main, 0.18),
        borderColor: alpha(theme.palette.primary.main, 0.5),
        // Suppress MUI's default dark-mode elevation overlay so the bgcolor
        // renders unmodified.
        backgroundImage: 'none',
        // Soft drop shadow so the card feels lifted off the page background.
        // Tuned for the dark theme — a near-black shadow at moderate alpha
        // reads as depth without competing with the primary-blue surface.
        boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.35)}`
      }}
    >
      <Stack spacing={0.9}>
        <Typography
          sx={{
            color: alpha(theme.palette.primary.light, 0.95),
            fontWeight: 700,
            fontSize: '0.72rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            lineHeight: 1.2
          }}
        >
          {label}
        </Typography>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline', flexWrap: 'wrap', rowGap: 0.25 }}>
          <Typography
            component="span"
            sx={{
              color: theme.palette.common.white,
              fontWeight: 700,
              fontSize: '1.6rem',
              lineHeight: 1.15
            }}
          >
            {value}
          </Typography>
          {unit ? (
            <Typography
              component="span"
              sx={{
                color: alpha(theme.palette.common.white, 0.55),
                fontWeight: 500,
                fontSize: '0.85rem'
              }}
            >
              {unit}
            </Typography>
          ) : null}
        </Stack>
        {helper ? (
          <Typography
            sx={{
              color: alpha(theme.palette.common.white, 0.55),
              fontWeight: 500,
              fontSize: '0.75rem',
              lineHeight: 1.4
            }}
          >
            {helper}
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
}

export default function Overview() {
  const theme = useTheme();
  const [overview, setOverview] = useState({
    total_field_seasons: 0,
    total_fields: 0,
    total_acres: 0,
    seasons_available: [],
    crops_available: [],
    yield_range: { min: 0, max: 0, avg: 0 },
    prediction_stats: {
      field_seasons_with_predictions: 0,
      total_predictions: 0,
      predicted_yield_avg: 0,
      predicted_yield_min: 0,
      predicted_yield_max: 0,
      field_predictions_total: 0,
      prediction_runs_total: 0
    }
  });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // Sample of fields for the hero map. Pulls a single page of the existing
  // /fields endpoint (which already returns lat/long per row) and uses up to
  // ~50 dots in the FieldMapPreview. We don't surface load errors here on
  // purpose — the map gracefully renders an empty silhouette if the fetch
  // fails, which is fine for a hero visual.
  const [mapFields, setMapFields] = useState([]);
  // Authoritative list of distinct states present in the field data,
  // pulled from /fields/states/ (which returns ALL states with at least one
  // field row, not just the 100-row mapFields sample). This is what
  // populates the banner's state dropdown so it always shows every state
  // the user could pick.
  const [dbStates, setDbStates] = useState([]);

  useEffect(() => {
    const controller = new AbortController();

    const loadOverview = async () => {
      setIsLoading(true);
      setLoadError('');
      try {
        const response = await fetch(`${API_BASE_URL}/fields/overview`, { signal: controller.signal });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to load overview (${response.status}): ${errorText}`);
        }

        const payload = await response.json();
        setOverview({
          total_field_seasons: payload?.total_field_seasons || 0,
          total_fields: payload?.total_fields || 0,
          total_acres: Number(payload?.total_acres) || 0,
          seasons_available: Array.isArray(payload?.seasons_available) ? payload.seasons_available : [],
          crops_available: Array.isArray(payload?.crops_available) ? payload.crops_available : [],
          yield_range: {
            min: Number(payload?.yield_range?.min) || 0,
            max: Number(payload?.yield_range?.max) || 0,
            avg: Number(payload?.yield_range?.avg) || 0
          },
          prediction_stats: {
            field_seasons_with_predictions: payload?.prediction_stats?.field_seasons_with_predictions || 0,
            total_predictions: payload?.prediction_stats?.total_predictions || 0,
            predicted_yield_avg: Number(payload?.prediction_stats?.predicted_yield_avg) || 0,
            predicted_yield_min: Number(payload?.prediction_stats?.predicted_yield_min) || 0,
            predicted_yield_max: Number(payload?.prediction_stats?.predicted_yield_max) || 0,
            field_predictions_total: payload?.prediction_stats?.field_predictions_total || 0,
            prediction_runs_total: payload?.prediction_stats?.prediction_runs_total || 0
          }
        });
      } catch (error) {
        if (error.name !== 'AbortError') {
          setLoadError(error.message || 'Failed to load overview metrics.');
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadOverview();

    return () => controller.abort();
  }, []);

  // Load a sample of fields with lat/long for the hero map. We fetch up to
  // 100 rows (the FieldMapPreview component picks the top 50 by acres) so
  // the map shows a representative geographic spread without a heavy
  // payload.
  useEffect(() => {
    const controller = new AbortController();
    const loadFields = async () => {
      try {
        // Bumped from 100 → 500 (the API cap) so the sample reliably
        // covers every state present in the dropdown. With 100, less-
        // represented states can be missing from the page entirely,
        // leaving the map without a pin for a state the user just picked.
        const response = await fetch(`${API_BASE_URL}/fields?limit=500`, { signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json();
        const rows = Array.isArray(payload?.data) ? payload.data : [];
        setMapFields(rows);
      } catch (error) {
        if (error.name !== 'AbortError') {
          // Silent: empty map silhouette is an acceptable fallback for the hero.
        }
      }
    };
    loadFields();
    return () => controller.abort();
  }, []);

  // Pull the full distinct-state list from /fields/states/. This is what
  // populates the banner's state dropdown — the 100-row mapFields sample
  // is too narrow (it might all happen to be Kansas), so we hit the
  // dedicated endpoint here for the authoritative list.
  useEffect(() => {
    const controller = new AbortController();
    const loadStates = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/fields/states/`, { signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json();
        const states = Array.isArray(payload)
          ? payload
              .map((entry) => (typeof entry === 'string' ? entry : entry?.state))
              .filter(Boolean)
          : [];
        setDbStates(states.sort());
      } catch (error) {
        if (error.name !== 'AbortError') {
          // Silent: dropdown will fall back to mapFields-derived list.
        }
      }
    };
    loadStates();
    return () => controller.abort();
  }, []);

  // Per-state aggregates from the API — count, total acres, avg yield,
  // distinct crops + varieties. Sourced from /fields/states/stats/ so
  // the map's hover popup shows real data for every state, not just
  // those that happen to be in the 500-row mapFields sample (which
  // skews heavily toward whichever state has the most rows).
  const [stateStats, setStateStats] = useState({});
  useEffect(() => {
    const controller = new AbortController();
    const loadStateStats = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/fields/states/stats/`, { signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json();
        if (!Array.isArray(payload)) return;
        const byName = {};
        payload.forEach((row) => {
          if (row?.state) byName[row.state] = row;
        });
        setStateStats(byName);
      } catch (error) {
        if (error.name !== 'AbortError') {
          // Silent: popup will fall back to mapFields-derived aggregates.
        }
      }
    };
    loadStateStats();
    return () => controller.abort();
  }, []);

  const predStats = overview.prediction_stats || {};
  const totalFieldSeasons = overview.total_field_seasons || 0;
  const withPredictions = predStats.field_seasons_with_predictions || 0;
  const coveragePct = totalFieldSeasons ? (100 * withPredictions) / totalFieldSeasons : 0;
  const cropsHelper = useMemo(() => {
    if (!Array.isArray(overview.crops_available)) return '';
    return overview.crops_available
      .map((crop) => (typeof crop === 'string' ? crop : crop?.crop_name))
      .filter(Boolean)
      .map(formatCropName)
      .join(', ');
  }, [overview.crops_available]);

  // Time-aware greeting + formatted date for the hero eyebrow. Computed once
  // per mount; the page is rendered fresh on each navigation so we don't need
  // to keep this updating on a timer.
  const greeting = useMemo(() => getTimeOfDayGreeting(), []);
  const todayLabel = useMemo(() => new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }), []);

  // Default featured state — "United States" is the nationwide aggregate
  // and serves as the dropdown's default first option. The user can drill
  // into a specific state via the banner's dropdown.
  const defaultFeaturedState = 'United States';

  // States the user can choose from in the banner dropdown. "United States"
  // always pinned at the top as the aggregate option, followed by the
  // alphabetized list of distinct states actually present in the data
  // (sourced from /fields/states/ when available, falling back to the
  // mapFields sample during the initial load). We deliberately do NOT
  // filter by STATE_HARVEST_DATES — the harvest helpers fall back to
  // Kansas defaults for unknown states, so it's better to show the user
  // every state in their data than to silently hide some.
  const availableStates = useMemo(() => {
    let realStates;
    if (dbStates.length > 0) {
      realStates = dbStates;
    } else if (Array.isArray(mapFields) && mapFields.length > 0) {
      const fromMap = new Set();
      mapFields.forEach((f) => {
        if (f?.state) fromMap.add(f.state);
      });
      realStates = Array.from(fromMap).sort();
    } else {
      realStates = Object.keys(STATE_HARVEST_DATES)
        .filter((s) => s !== 'United States')
        .sort();
    }
    return ['United States', ...realStates];
  }, [dbStates, mapFields]);

  // User-selected override for the state dropdown — falls back to the
  // computed default when null.
  const [stateOverride, setStateOverride] = useState(null);
  const featuredState = stateOverride || defaultFeaturedState;
  // Anchors for the two banner popovers: the info bubble next to the stage
  // detail, and the state dropdown menu.
  const [infoAnchor, setInfoAnchor] = useState(null);
  const [stateMenuAnchor, setStateMenuAnchor] = useState(null);

  // Wheat-stage info for the banner. Recomputed on every render so the
  // stage/days reflect "now" — cheap, no useMemo needed.
  const stageInfo = getWheatStage();
  const daysToHarvest = getDaysToHarvest(new Date(), featuredState);
  const seasonProgress = getSeasonProgress(new Date(), featuredState);

  // Human-friendly plant + harvest dates for the season-progress tooltip,
  // so the user can see exactly what window the percentage covers.
  const seasonWindow = useMemo(() => {
    const plant = STATE_PLANT_DATES[featuredState] || STATE_PLANT_DATES.Kansas;
    const harvest = STATE_HARVEST_DATES[featuredState] || STATE_HARVEST_DATES.Kansas;
    const fmt = (m, d) =>
      new Date(2000, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return { plantLabel: fmt(plant.month, plant.day), harvestLabel: fmt(harvest.month, harvest.day) };
  }, [featuredState]);

  // States the map should spotlight. "United States" lights up every
  // dropdown state at once; a specific pick narrows the map to only that
  // one. We slice off the leading "United States" entry so the highlight
  // set always represents real states, never the aggregate label.
  const highlightedStates = useMemo(() => {
    const realStates = availableStates.filter((s) => s !== 'United States');
    if (featuredState === 'United States') return realStates;
    return [featuredState];
  }, [featuredState, availableStates]);

  // Shared Tooltip styling so all hero tooltips read as part of the page's
  // Deep-Learning-pill family rather than the default neutral-gray MUI
  // tooltip. Surface uses the same color-mix tint as the Field Performance
  // Records card / state info popover; arrow inherits the same fill so it
  // continues the surface seamlessly.
  const themedTooltipBg = `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})`;
  const themedTooltipSlotProps = {
    tooltip: {
      sx: {
        bgcolor: themedTooltipBg,
        color: theme.palette.common.white,
        border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
        boxShadow: `0 6px 16px ${alpha(theme.palette.common.black, 0.45)}`,
        backgroundImage: 'none',
        fontSize: '0.78rem',
        fontWeight: 500,
        letterSpacing: '0.01em',
        px: 1.25,
        py: 0.85,
        borderRadius: 1,
        maxWidth: 280
      }
    },
    arrow: {
      sx: {
        color: themedTooltipBg,
        // The "&::before" trick re-tints the arrow's pseudo-element so the
        // inherited color picks up our themed bg rather than MUI's default
        // gray. Border on the arrow keeps the outline continuous with the
        // tooltip body's primary border.
        '&::before': {
          backgroundColor: themedTooltipBg,
          border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`
        }
      }
    }
  };

  // No title prop on MainCard — the parent tab is already named "Overview",
  // so a second header inside the card was redundant. MainCard skips the
  // CardHeader entirely when title is omitted.
  return (
    <MainCard>
      <Stack spacing={2.5}>
        <Paper
          variant="outlined"
          sx={{
            position: 'relative',
            overflow: 'hidden',
            borderColor: alpha(theme.palette.primary.main, 0.28),
            // Primary-only gradient mesh so the hero shares the same blue
            // family as the metric / coverage / table cards on the page
            // (the previous version mixed in success-green, which broke the
            // color story). Two radial glows + a directional linear, all
            // primary, with `background-size: 200%` giving the slow drift
            // animation room to travel.
            backgroundImage: `radial-gradient(120% 120% at 0% 0%, ${alpha(
              theme.palette.primary.main,
              0.28
            )} 0%, transparent 55%), radial-gradient(120% 120% at 100% 100%, ${alpha(
              theme.palette.primary.main,
              0.14
            )} 0%, transparent 60%), linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.2)} 0%, ${alpha(
              theme.palette.primary.main,
              0.04
            )} 55%, ${alpha(theme.palette.background.paper, 0.55)} 100%)`,
            backgroundSize: '200% 200%, 200% 200%, 100% 100%',
            backgroundPosition: '0% 50%, 100% 50%, 0% 0%',
            animation: 'heroShift 28s ease-in-out infinite',
            '@keyframes heroShift': {
              '0%, 100%': { backgroundPosition: '0% 50%, 100% 50%, 0% 0%' },
              '50%': { backgroundPosition: '100% 50%, 0% 50%, 0% 0%' }
            },
            // Soft drop shadow matching the rest of the page's cards.
            boxShadow: `0 6px 20px ${alpha(theme.palette.common.black, 0.4)}`
          }}
        >
          {/* Seasonal / growing-stage banner — strip across the top of the
              hero card. Anchors the page in time: "this is a living crop,
              not a static dataset". The thin progress bar visualizes how
              far we are through the planting → harvest cycle for the
              featured state (chosen from the actual data when possible). */}
          <Box
            sx={{
              px: { xs: 2, md: 3 },
              py: 1.25,
              borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.28)}`,
              bgcolor: alpha(theme.palette.primary.main, 0.12)
            }}
          >
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'nowrap', minWidth: 0 }}>
              {/* "Currently in" stage indicator with a pulsing dot to
                  emphasize that this is a live state, not a label. */}
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                <Box
                  component="span"
                  aria-hidden
                  sx={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    bgcolor: theme.palette.success.main,
                    boxShadow: `0 0 0 0 ${alpha(theme.palette.success.main, 0.55)}`,
                    animation: 'stagePulse 2.4s ease-in-out infinite',
                    '@keyframes stagePulse': {
                      '0%, 100%': { boxShadow: `0 0 0 0 ${alpha(theme.palette.success.main, 0.55)}` },
                      '50%': { boxShadow: `0 0 0 6px ${alpha(theme.palette.success.main, 0)}` }
                    },
                    flexShrink: 0
                  }}
                />
                <Typography
                  sx={{
                    color: alpha(theme.palette.common.white, 0.55),
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase'
                  }}
                >
                  Currently
                </Typography>
                <Typography
                  sx={{
                    color: theme.palette.common.white,
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    letterSpacing: '0.01em'
                  }}
                >
                  {stageInfo.label}
                </Typography>
                <Typography
                  sx={{
                    color: alpha(theme.palette.common.white, 0.55),
                    fontSize: '0.78rem',
                    fontWeight: 500,
                    // Hidden until lg so the banner never has to wrap a
                    // long stage detail (e.g. "Hard dough · ready to
                    // combine") onto a second line when the drawer is open.
                    display: { xs: 'none', lg: 'inline' },
                    whiteSpace: 'nowrap'
                  }}
                >
                  · {stageInfo.detail}
                </Typography>
                {/* Info button — click pops a small Popover with a longer
                    explanation of the current stage and a "Learn more" link
                    to a reputable agronomy reference. We use Popover (not
                    Tooltip) so the link inside is actually clickable. */}
                <Tooltip title="More about this stage" arrow slotProps={themedTooltipSlotProps}>
                  <IconButton
                    size="small"
                    onClick={(e) => setInfoAnchor(e.currentTarget)}
                    sx={{
                      ml: 0.25,
                      color: alpha(theme.palette.primary.light, 0.85),
                      p: 0.4,
                      '&:hover': {
                        color: theme.palette.primary.light,
                        bgcolor: alpha(theme.palette.primary.main, 0.18)
                      }
                    }}
                    aria-label={`More about the ${stageInfo.label} stage`}
                  >
                    <InfoCircleOutlined style={{ fontSize: '0.85rem' }} />
                  </IconButton>
                </Tooltip>
              </Stack>
              {/* Spacer pushes the right cluster to the far edge on wide
                  screens. The whole row is locked to nowrap so a narrowed
                  viewport (e.g. drawer open) never bumps the right
                  cluster onto a second line — instead the spacer
                  collapses and the secondary text inside each cluster is
                  hidden via `display: { xs: 'none' }` rules below. */}
              <Box sx={{ flex: 1, minWidth: 0 }} />
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'nowrap', flexShrink: 0 }}>
                <Stack
                  direction="row"
                  spacing={0.75}
                  sx={{ alignItems: 'center', color: alpha(theme.palette.common.white, 0.78), fontSize: '0.8rem' }}
                >
                  <Typography component="span" sx={{ fontSize: 'inherit', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    <Box component="span" sx={{ color: theme.palette.primary.light, fontWeight: 700 }}>
                      {daysToHarvest}
                    </Box>{' '}
                    days to harvest in
                  </Typography>
                  {/* State picker — replaces the static "Kansas" with a
                      dropdown of states actually present in the field data
                      (and that we have a known harvest date for). Defaults
                      to the most-represented state; user pick is sticky for
                      the session via stateOverride. */}
                  <Button
                    size="small"
                    onClick={(e) => setStateMenuAnchor(e.currentTarget)}
                    endIcon={<DownOutlined style={{ fontSize: '0.62rem' }} />}
                    sx={{
                      // Hover behavior mirrors the Model selection pill in
                      // FieldTable: identical 4-property transition (bg,
                      // border, box-shadow, color) and a 2px primary halo
                      // on hover so the affordance reads consistently
                      // across the page's pill family.
                      textTransform: 'none',
                      fontWeight: 700,
                      fontSize: '0.8rem',
                      letterSpacing: '0.01em',
                      minHeight: 0,
                      whiteSpace: 'nowrap',
                      py: 0.15,
                      px: 0.85,
                      borderRadius: 999,
                      color: alpha(theme.palette.primary.light, 0.95),
                      bgcolor: alpha(theme.palette.primary.main, 0.18),
                      border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
                      transition:
                        'background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease',
                      '&:hover': {
                        color: theme.palette.common.white,
                        bgcolor: alpha(theme.palette.primary.main, 0.32),
                        borderColor: theme.palette.primary.main,
                        boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.18)}`
                      }
                    }}
                  >
                    {featuredState}
                  </Button>
                </Stack>
                {/* Season-progress bar + clarified label. The percentage now
                    reads "X% through season" with a Tooltip on the whole
                    cluster explaining the actual planting → harvest dates
                    that the bar measures against. */}
                <Tooltip
                  arrow
                  slotProps={themedTooltipSlotProps}
                  title={
                    <Box sx={{ p: 0.25 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.25, color: 'inherit' }}>
                        Season progress
                      </Typography>
                      <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.45, color: 'inherit' }}>
                        How far {featuredState} winter wheat is through its
                        planting → harvest cycle right now.
                      </Typography>
                      <Typography sx={{ fontSize: '0.7rem', mt: 0.5, opacity: 0.85, color: 'inherit' }}>
                        Plant ≈ {seasonWindow.plantLabel} · Harvest ≈ {seasonWindow.harvestLabel}
                      </Typography>
                    </Box>
                  }
                >
                  <Stack
                    direction="row"
                    spacing={0.75}
                    sx={{
                      alignItems: 'center',
                      cursor: 'help',
                      // Drop the progress bar entirely on narrow widths
                      // (e.g. drawer-open). The "days to harvest"
                      // headline still tells the user where they are in
                      // the season, and the bar reappears at md+.
                      display: { xs: 'none', md: 'flex' }
                    }}
                  >
                    <Box
                      sx={{
                        width: { xs: 80, sm: 120 },
                        height: 4,
                        borderRadius: 2,
                        bgcolor: alpha(theme.palette.primary.main, 0.22),
                        overflow: 'hidden',
                        position: 'relative'
                      }}
                    >
                      <Box
                        sx={{
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: `${seasonProgress}%`,
                          background: `linear-gradient(90deg, ${theme.palette.primary.main} 0%, ${theme.palette.success.light} 100%)`,
                          transition: 'width 0.6s ease'
                        }}
                      />
                    </Box>
                    <Typography
                      sx={{
                        color: alpha(theme.palette.common.white, 0.7),
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {Math.round(seasonProgress)}% through season
                    </Typography>
                  </Stack>
                </Tooltip>
              </Stack>
            </Stack>
          </Box>

          {/* Stage-info popover — opened by the (i) icon in the banner. */}
          <Popover
            open={Boolean(infoAnchor)}
            anchorEl={infoAnchor}
            onClose={() => setInfoAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            slotProps={{
              paper: {
                sx: {
                  bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})`,
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
                  borderRadius: 1.25,
                  backgroundImage: 'none',
                  maxWidth: 360,
                  mt: 0.5,
                  boxShadow: `0 8px 22px ${alpha(theme.palette.common.black, 0.45)}`
                }
              }
            }}
          >
            <Box sx={{ p: 2 }}>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                <Typography sx={{ color: theme.palette.common.white, fontWeight: 700, fontSize: '0.95rem' }}>
                  {stageInfo.label}
                </Typography>
                <Typography sx={{ color: alpha(theme.palette.common.white, 0.7), fontSize: '0.78rem' }}>
                  · {stageInfo.detail}
                </Typography>
              </Stack>
              <Typography
                sx={{
                  color: alpha(theme.palette.common.white, 0.85),
                  fontSize: '0.82rem',
                  lineHeight: 1.55,
                  mt: 1
                }}
              >
                {stageInfo.description}
              </Typography>
              {stageInfo.link ? (
                <Box sx={{ mt: 1.25 }}>
                  <Box
                    component="a"
                    href={stageInfo.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.5,
                      color: theme.palette.primary.light,
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      textDecoration: 'none',
                      letterSpacing: '0.02em',
                      '&:hover': {
                        color: theme.palette.common.white,
                        textDecoration: 'underline'
                      }
                    }}
                  >
                    Learn more →
                  </Box>
                </Box>
              ) : null}
            </Box>
          </Popover>

          {/* State picker menu — opens from the dropdown button in the banner. */}
          <Menu
            anchorEl={stateMenuAnchor}
            open={Boolean(stateMenuAnchor)}
            onClose={() => setStateMenuAnchor(null)}
            slotProps={{
              paper: {
                sx: {
                  bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 8%, ${theme.palette.background.paper})`,
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.4)}`,
                  borderRadius: 1.25,
                  backgroundImage: 'none',
                  mt: 0.5,
                  maxHeight: 320,
                  '& .MuiMenuItem-root': {
                    color: alpha(theme.palette.common.white, 0.88),
                    fontSize: '0.85rem',
                    minHeight: 32,
                    '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.16) },
                    '&.Mui-selected': {
                      bgcolor: alpha(theme.palette.primary.main, 0.28),
                      '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.36) }
                    }
                  }
                }
              }
            }}
          >
            {availableStates.map((state) => (
              <MenuItem
                key={state}
                selected={state === featuredState}
                onClick={() => {
                  setStateOverride(state);
                  setStateMenuAnchor(null);
                }}
              >
                {state}
              </MenuItem>
            ))}
          </Menu>

          <Grid container spacing={0}>
            <Grid size={{ xs: 12, md: 7 }}>
              <Stack spacing={2} sx={{ p: { xs: 2.5, md: 3.5 } }}>
                <Stack spacing={0.4}>
                  {/* Eyebrow — brand line + today's date so the page reads
                      as fresh and contextual on every visit. */}
                  <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                    <Typography
                      sx={{
                        color: alpha(theme.palette.primary.light, 0.95),
                        fontWeight: 700,
                        fontSize: '0.72rem',
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase'
                      }}
                    >
                      Wheat Trait Intelligence
                    </Typography>
                    <Box
                      component="span"
                      aria-hidden
                      sx={{
                        width: 4,
                        height: 4,
                        borderRadius: '50%',
                        bgcolor: alpha(theme.palette.primary.light, 0.5),
                        display: 'inline-block'
                      }}
                    />
                    <Typography
                      sx={{
                        color: alpha(theme.palette.common.white, 0.6),
                        fontSize: '0.72rem',
                        fontWeight: 500,
                        letterSpacing: '0.04em'
                      }}
                    >
                      {todayLabel}
                    </Typography>
                  </Stack>
                  {/* Time-aware personalized greeting — the hero's emotional
                      anchor. Reads as "this product knows you" rather than
                      a generic banner. */}
                  <Typography
                    variant="h3"
                    sx={{
                      color: theme.palette.common.white,
                      fontWeight: 700,
                      letterSpacing: '-0.01em',
                      lineHeight: 1.15
                    }}
                  >
                    {greeting}, {USER_NAME}
                  </Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 560 }}>
                  Track crop performance, model coverage, and yield signals in one view. This dashboard blends observed field outcomes with
                  machine-learning predictions to help prioritize decisions quickly.
                </Typography>
              </Stack>
            </Grid>
            <Grid size={{ xs: 12, md: 5 }}>
              {/* Field map — real US states SVG with pins on states that
                  have field data. Tighter padding here than the previous
                  iteration so the map fills the column rather than floating
                  in whitespace. */}
              <Box
                sx={{
                  position: 'relative',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  px: { xs: 1.5, md: 1 },
                  py: { xs: 1, md: 1.5 },
                  height: '100%'
                }}
              >
                <FieldMapPreview
                  fields={mapFields}
                  yieldRange={overview.yield_range}
                  highlightedStates={highlightedStates}
                  stateStats={stateStats}
                  // Pass the dropdown's real-state count so the legend
                  // caption reflects every state we have data for in
                  // the DB (via /fields/states/), not just the subset
                  // that happened to be in the 100/500-row mapFields
                  // sample. "United States" is excluded since it's the
                  // aggregate label, not a state.
                  totalStatesCount={availableStates.filter((s) => s !== 'United States').length}
                />
              </Box>
            </Grid>
          </Grid>
        </Paper>

        <Stack spacing={0.75}>
          <Typography variant="h5">Summary Metrics</Typography>

          {loadError ? (
            <Typography variant="caption" color="error.main">
              {loadError}
            </Typography>
          ) : null}
          {isLoading ? (
            <Typography variant="caption" color="text.secondary">
              Loading overview metrics...
            </Typography>
          ) : null}
        </Stack>

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
            <MetricTile
              label="Total Acres"
              value={overview.total_acres.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              helper="Sum of acres across all fields"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
            <MetricTile label="Fields" value={overview.total_fields.toLocaleString()} helper="Distinct field IDs in the system" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
            <MetricTile label="Seasons" value={String(overview.seasons_available.length)} helper={overview.seasons_available.join(', ')} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
            <MetricTile label="Crops" value={String(overview.crops_available.length)} helper={cropsHelper} />
          </Grid>
        </Grid>

        <Divider />

        <Stack spacing={1.5}>
          <Typography variant="h5">Observed Yield Range</Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 4 }}>
              <MetricTile label="Min Yield" value={overview.yield_range.min.toFixed(1)} unit="bu/ac" />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <MetricTile label="Max Yield" value={overview.yield_range.max.toFixed(1)} unit="bu/ac" />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <MetricTile label="Avg Yield" value={overview.yield_range.avg.toFixed(1)} unit="bu/ac" />
            </Grid>
          </Grid>
        </Stack>

        <Divider />

        <Stack spacing={1.5}>
          <Stack spacing={0.25}>
            <Typography variant="h5">Prediction Statistics</Typography>
            <Typography sx={{ color: alpha(theme.palette.common.white, 0.5), fontSize: '0.8rem' }}>
              {(predStats.field_predictions_total || 0).toLocaleString()} field predictions ·{' '}
              {(predStats.prediction_runs_total || 0).toLocaleString()} prediction runs
            </Typography>
          </Stack>

          {/* Coverage card — same Deep-Learning-pill palette as the metric
              tiles so all summary cards on this page share the same saturated
              primary surface and matching half-alpha border. */}
          <Paper
            variant="outlined"
            sx={{
              bgcolor: alpha(theme.palette.primary.main, 0.18),
              borderColor: alpha(theme.palette.primary.main, 0.5),
              borderRadius: 2,
              p: 2.25,
              backgroundImage: 'none',
              boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.35)}`
            }}
          >
            <Stack spacing={1.25}>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography
                  sx={{
                    color: alpha(theme.palette.primary.light, 0.95),
                    fontWeight: 700,
                    fontSize: '0.72rem',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase'
                  }}
                >
                  Coverage
                </Typography>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline' }}>
                  <Typography
                    component="span"
                    sx={{ color: theme.palette.common.white, fontWeight: 700, fontSize: '1.25rem', lineHeight: 1.15 }}
                  >
                    {coveragePct.toFixed(1)}%
                  </Typography>
                  <Typography component="span" sx={{ color: alpha(theme.palette.common.white, 0.55), fontSize: '0.78rem' }}>
                    of field-seasons
                  </Typography>
                </Stack>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={coveragePct}
                sx={{
                  height: 8,
                  borderRadius: 2,
                  bgcolor: alpha(theme.palette.primary.main, 0.18),
                  '& .MuiLinearProgress-bar': {
                    borderRadius: 2,
                    bgcolor:
                      coveragePct >= 90
                        ? theme.palette.success.main
                        : coveragePct >= 75
                          ? theme.palette.warning.main
                          : theme.palette.info.main
                  }
                }}
              />
              <Typography sx={{ color: alpha(theme.palette.common.white, 0.55), fontSize: '0.78rem' }}>
                {withPredictions.toLocaleString()} of {totalFieldSeasons.toLocaleString()} field-seasons have predictions
              </Typography>
            </Stack>
          </Paper>

          <Grid container spacing={2}>
            <Grid size={{ xs: 6, md: 3 }}>
              <MetricTile
                label="Total Predictions"
                value={(predStats.total_predictions || 0).toLocaleString()}
                helper="Across all stored predictions"
              />
            </Grid>
            <Grid size={{ xs: 6, md: 3 }}>
              <MetricTile
                label="Avg Predicted Yield"
                value={(predStats.predicted_yield_avg || 0).toFixed(1)}
                unit="bu/ac"
                helper="Mean across predictions"
              />
            </Grid>
            <Grid size={{ xs: 6, md: 3 }}>
              <MetricTile label="Min Predicted" value={(predStats.predicted_yield_min || 0).toFixed(1)} unit="bu/ac" />
            </Grid>
            <Grid size={{ xs: 6, md: 3 }}>
              <MetricTile label="Max Predicted" value={(predStats.predicted_yield_max || 0).toFixed(1)} unit="bu/ac" />
            </Grid>
          </Grid>
        </Stack>

        <Divider />

        <FieldTable />
      </Stack>
    </MainCard>
  );
}
