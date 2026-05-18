// Predicted-vs-Observed regression diagnostic plot for the Model & Data view.
//
// One point per field-season that has both a stored prediction and an
// observed yield. The dashed gray diagonal is the "perfect prediction"
// y=x reference; the solid colored line is the OLS fit through the points;
// the header pill row carries R² / RMSE / MAE / n.
//
// Points are colored by signed residual (predicted − observed) using a
// diverging palette: cool blue when the model under-predicts and warm
// orange when it over-predicts. Hover any point for a field-level
// readout.

import { useEffect, useMemo, useRef, useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';
import DownOutlined from '@ant-design/icons/DownOutlined';

import FieldDetailDrawer from 'sections/intelligence/crop-studio/FieldDetailDrawer';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

// SVG layout constants. The plot is drawn in a 1000×620 viewBox and the
// SVG element stretches to fit its container; preserveAspectRatio keeps
// it letterboxed cleanly at any width.
const VIEW_W = 1000;
// VIEW_H controls the SVG aspect ratio. The SVG itself is sized to
// `width: 100%`, `height: auto`, so the rendered pixel height tracks
// `VIEW_H / VIEW_W` against the container width. Dropping from 620 to
// 465 makes the regression plot ~25% shorter without disturbing
// margins, tick spacing, or any of the plot math (everything else is
// derived from VIEW_H / PLOT_H).
const VIEW_H = 465;
const MARGIN = { top: 24, right: 24, bottom: 56, left: 64 };
const PLOT_W = VIEW_W - MARGIN.left - MARGIN.right;
const PLOT_H = VIEW_H - MARGIN.top - MARGIN.bottom;

// Friendly display name for raw model_type strings. Mirrors the mapping
// in Analytics.jsx / ModelSelectionStep so labels read consistently.
function getModelDisplayName(modelType, fallbackTag) {
  const key = String(modelType || '').toLowerCase();
  if (key.includes('deep') || key.includes('pytorch') || key.includes('neural')) return 'Deep Learning';
  if (key.includes('catboost') || key.includes('lgbm') || key.includes('lightgbm') || key.includes('boost')) return 'CatBoost';
  if (key.includes('forest') || key.includes('tree')) return 'Random Forest';
  if (key.includes('xgb')) return 'XGBoost';
  return modelType || fallbackTag || 'Unknown';
}

// Type predicates used to (a) hide Deep Learning from the model dropdown
// and (b) prefer CatBoost as the default selection. The CatBoost family
// includes lightgbm + gradient-boosting variants per the project-wide
// naming convention.
function isDeepLearning(model) {
  const key = String(model?.model_type || '').toLowerCase();
  return key.includes('deep') || key.includes('pytorch') || key.includes('neural');
}

function isCatBoost(model) {
  const key = String(model?.model_type || '').toLowerCase();
  return key.includes('catboost') || key.includes('lgbm') || key.includes('lightgbm') || key.includes('boost');
}

// "Nice" tick step for a given range. Snaps to {1, 2, 5} × 10^k so the
// axis labels read as clean round numbers regardless of the data scale.
function niceStep(range, targetTicks = 6) {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const rough = range / targetTicks;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  let step;
  if (norm < 1.5) step = 1;
  else if (norm < 3) step = 2;
  else if (norm < 7) step = 5;
  else step = 10;
  return step * mag;
}

function generateTicks(min, max) {
  const step = niceStep(max - min);
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let t = start; t <= max + step * 0.001; t += step) {
    ticks.push(t);
  }
  return ticks;
}

// Diverging color from a signed residual. Symmetric around zero — the
// further from zero, the more saturated. `maxAbs` is the residual scale
// the colormap is normalized against (typically 2*RMSE).
function residualColor(residual, maxAbs, theme) {
  if (!Number.isFinite(residual) || maxAbs <= 0) {
    return alpha(theme.palette.primary.main, 0.7);
  }
  const t = Math.max(-1, Math.min(1, residual / maxAbs));
  // info.main (blue) at t=-1, common white at t=0, warning.main (orange) at t=+1.
  // Returns a 6-char hex by mixing two endpoints linearly in sRGB.
  const cold = theme.palette.info.light; // under-predicted
  const hot = theme.palette.warning.light; // over-predicted
  const neutral = alpha(theme.palette.common.white, 0.4);
  // Use color-mix via CSS so we don't have to parse hex ourselves.
  const ratio = Math.abs(t) * 100;
  const target = t < 0 ? cold : hot;
  return `color-mix(in srgb, ${target} ${ratio.toFixed(0)}%, ${neutral})`;
}

export default function ModelRegressionCard() {
  const theme = useTheme();
  const [models, setModels] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modelMenuAnchor, setModelMenuAnchor] = useState(null);
  const [seasonMenuAnchor, setSeasonMenuAnchor] = useState(null);
  const [stateMenuAnchor, setStateMenuAnchor] = useState(null);
  const [hoverPoint, setHoverPoint] = useState(null);
  // Active filters. `season` is an array (the backend accepts multiple),
  // but the dropdown UI is single-select so the array will have length 0
  // or 1 in practice. `state` is a single optional string.
  const [seasonFilter, setSeasonFilter] = useState([]);
  const [stateFilter, setStateFilter] = useState(null);
  // Drawer state — clicking a point opens the FieldDetailDrawer (same one
  // the FieldTable / Overview chevron opens). null = closed.
  const [drawerFieldSeasonId, setDrawerFieldSeasonId] = useState(null);

  // Pull the registered model versions for the dropdown. Deep Learning
  // is filtered out here so it never appears as a selectable option —
  // the scatter card is intentionally scoped to gradient-boosted +
  // tree-based models. A separate effect picks the default selection
  // once this list lands.
  const [modelsResolved, setModelsResolved] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/models/versions?limit=500`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (Array.isArray(rows)) {
          setModels(rows.filter((m) => !isDeepLearning(m)));
        }
        setModelsResolved(true);
      })
      .catch(() => {
        /* silent — selector just stays empty */
        setModelsResolved(true);
      });
    return () => controller.abort();
  }, []);

  // Pick the default selection as soon as the models list lands. CatBoost
  // is the preferred family; within CatBoost we prefer the production
  // model. If no CatBoost models exist we fall through to whatever the
  // backend would have resolved by default (request with no model_id).
  useEffect(() => {
    if (!modelsResolved || selectedId !== null) return;
    if (models.length === 0) {
      // No filtered models available → leave selectedId null so the
      // scatter fetch below falls through to the production-default
      // backend behavior.
      setSelectedId(0);
      return;
    }
    const preferred =
      models.find((m) => m.is_production && isCatBoost(m)) || models.find(isCatBoost) || models.find((m) => m.is_production) || models[0];
    setSelectedId(preferred.model_version_id);
  }, [modelsResolved, models, selectedId]);

  // Fetch scatter data whenever the selected model changes. We gate on
  // `selectedId !== null` so we never make the request before the
  // default-selection effect above has had a chance to pick CatBoost —
  // otherwise the initial fetch would race with the default-picker and
  // briefly show whichever model the backend resolves to. A sentinel
  // value of 0 means "models list was empty; let backend pick".
  useEffect(() => {
    if (selectedId === null) return;
    const controller = new AbortController();
    // Compose query string. `model_id` is omitted when we're in the
    // sentinel state (let backend pick production); season + state are
    // appended only when set. URLSearchParams handles repeated `season`
    // entries via .append.
    const params = new URLSearchParams();
    if (selectedId > 0) params.append('model_id', String(selectedId));
    for (const year of seasonFilter) params.append('season', String(year));
    if (stateFilter) params.append('state', stateFilter);
    const url = `${API_BASE_URL}/predict/scatter${params.toString() ? `?${params.toString()}` : ''}`;
    setLoading(true);
    setError('');
    fetch(url, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
        return r.json();
      })
      .then((p) => {
        setPayload(p);
        // Sentinel case: backend resolved to its own default (production).
        // Sync the selector to that model so subsequent re-fetches are
        // explicit about which model we're asking for.
        if (selectedId === 0 && p?.model_version?.model_version_id) {
          setSelectedId(p.model_version.model_version_id);
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message || 'Failed to load scatter data.');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [selectedId, seasonFilter, stateFilter]);

  // Derive everything the SVG needs in one pass: scaled coordinates,
  // axis bounds, residual color scale, fitted-line endpoints. We memoize
  // on `payload` so hover events don't recompute the layout.
  const layout = useMemo(() => {
    const points = Array.isArray(payload?.points) ? payload.points : [];
    if (points.length === 0) return null;

    const metrics = payload?.metrics || {};
    // Use a unified axis range — same min/max on both x and y — so the
    // 1:1 reference line is always a true diagonal of the plot area.
    const allValues = [];
    for (const p of points) {
      allValues.push(p.observed, p.predicted);
    }
    const rawMin = Math.min(...allValues);
    const rawMax = Math.max(...allValues);
    // Pad by 5% of the range on each side so the points don't kiss the
    // axes. Round outward to a nice tick for a clean axis line.
    const range = rawMax - rawMin || 1;
    const pad = range * 0.05;
    const step = niceStep(range + 2 * pad);
    const min = Math.floor((rawMin - pad) / step) * step;
    const max = Math.ceil((rawMax + pad) / step) * step;

    const xScale = (v) => MARGIN.left + ((v - min) / (max - min)) * PLOT_W;
    const yScale = (v) => MARGIN.top + PLOT_H - ((v - min) / (max - min)) * PLOT_H;

    // Diverging color scale: saturate at 2*RMSE so the bulk of points
    // sit in the mid-range and only the outliers go full saturation.
    const rmse = Number.isFinite(metrics.rmse) ? metrics.rmse : 0;
    const colorMaxAbs = Math.max(2 * rmse, 1);

    const scatter = points.map((p) => ({
      ...p,
      cx: xScale(p.observed),
      cy: yScale(p.predicted),
      fill: residualColor(p.residual, colorMaxAbs, theme)
    }));

    // Fitted-line endpoints. Compute against the axis bounds rather than
    // the data bounds so the line spans the plot edge-to-edge.
    const slope = Number.isFinite(metrics.slope) ? metrics.slope : null;
    const intercept = Number.isFinite(metrics.intercept) ? metrics.intercept : null;
    const fitted =
      slope !== null && intercept !== null
        ? [
            { x: min, y: slope * min + intercept },
            { x: max, y: slope * max + intercept }
          ]
        : null;

    const xTicks = generateTicks(min, max);

    return { min, max, xScale, yScale, scatter, fitted, xTicks, metrics };
  }, [payload, theme]);

  const selectedModel =
    models.find((m) => m.model_version_id === selectedId) ||
    (payload?.model_version
      ? {
          model_version_id: payload.model_version.model_version_id,
          version_tag: payload.model_version.version_tag,
          model_type: payload.model_version.model_type,
          is_production: payload.model_version.is_production
        }
      : null);
  const modelLabel = selectedModel ? getModelDisplayName(selectedModel.model_type, selectedModel.version_tag) : 'Select model';

  return (
    <Paper
      variant="outlined"
      sx={{
        bgcolor: alpha(theme.palette.primary.main, 0.18),
        borderColor: alpha(theme.palette.primary.main, 0.5),
        borderRadius: 2,
        overflow: 'hidden',
        backgroundImage: 'none',
        boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.35)}`
      }}
    >
      {/* Header — title + model selector on the left, metrics pills on
          the right. The metrics row is the heart of the card: at a
          glance, R² tells you how much of the variance the model
          captures, RMSE/MAE quantify how far off it is in bu/ac, and n
          shows how many real harvest records back the read. */}
      <Stack
        direction="row"
        sx={{
          px: 2.5,
          py: 1.5,
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.18)}`,
          flexWrap: 'wrap',
          gap: 1.5
        }}
      >
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.95rem', color: theme.palette.common.white }}>Predicted vs Observed</Typography>
          <Typography sx={{ color: alpha(theme.palette.common.white, 0.55), fontSize: '0.78rem' }}>
            Regression diagnostic across every harvested field-season
          </Typography>
          <Button
            size="small"
            onClick={(e) => setModelMenuAnchor(e.currentTarget)}
            endIcon={<DownOutlined style={{ fontSize: '0.62rem' }} />}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              fontSize: '0.78rem',
              minHeight: 0,
              py: 0.2,
              px: 1.1,
              borderRadius: 999,
              color: alpha(theme.palette.primary.light, 0.95),
              bgcolor: alpha(theme.palette.primary.main, 0.18),
              border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
              '&:hover': {
                color: theme.palette.common.white,
                bgcolor: alpha(theme.palette.primary.main, 0.32),
                borderColor: theme.palette.primary.main
              }
            }}
          >
            {modelLabel}
          </Button>
          <Menu
            anchorEl={modelMenuAnchor}
            open={Boolean(modelMenuAnchor)}
            onClose={() => setModelMenuAnchor(null)}
            slotProps={{
              paper: {
                sx: {
                  bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 8%, ${theme.palette.background.paper})`,
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.32)}`,
                  borderRadius: 1.25,
                  mt: 0.5,
                  '& .MuiMenuItem-root': {
                    color: alpha(theme.palette.common.white, 0.88),
                    fontSize: '0.85rem',
                    minHeight: 32,
                    '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.16) },
                    '&.Mui-selected': {
                      bgcolor: alpha(theme.palette.primary.main, 0.24),
                      '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.32) }
                    }
                  }
                }
              }
            }}
          >
            {models.map((m) => (
              <MenuItem
                key={m.model_version_id}
                selected={selectedId === m.model_version_id}
                onClick={() => {
                  setSelectedId(m.model_version_id);
                  setModelMenuAnchor(null);
                }}
              >
                {getModelDisplayName(m.model_type, m.version_tag)}
                {m.is_production ? (
                  <Box
                    component="span"
                    sx={{
                      ml: 1,
                      fontSize: '0.66rem',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: theme.palette.success.light
                    }}
                  >
                    · prod
                  </Box>
                ) : null}
              </MenuItem>
            ))}
          </Menu>

          {/* Season filter pill — narrows the scatter to one growing
              season. Useful for reproducing the slice your training set
              was cut on (R² typically rises when you restrict to a
              single season the model was tuned for). The "All seasons"
              option clears the filter. */}
          <FilterPill
            label={seasonFilter.length > 0 ? `Season ${seasonFilter[0]}` : 'All seasons'}
            active={seasonFilter.length > 0}
            anchor={seasonMenuAnchor}
            setAnchor={setSeasonMenuAnchor}
            options={[
              { label: 'All seasons', value: null },
              ...(payload?.available_filters?.seasons || []).map((y) => ({ label: String(y), value: y }))
            ]}
            selectedValue={seasonFilter.length > 0 ? seasonFilter[0] : null}
            onSelect={(value) => setSeasonFilter(value === null ? [] : [value])}
            theme={theme}
          />

          {/* State filter pill — narrows the scatter to a single state.
              Pairs naturally with the season filter to reproduce the
              training subset (e.g. 'Kansas, 2024'). */}
          <FilterPill
            label={stateFilter || 'All states'}
            active={Boolean(stateFilter)}
            anchor={stateMenuAnchor}
            setAnchor={setStateMenuAnchor}
            options={[
              { label: 'All states', value: null },
              ...(payload?.available_filters?.states || []).map((s) => ({ label: s, value: s }))
            ]}
            selectedValue={stateFilter}
            onSelect={setStateFilter}
            theme={theme}
          />
        </Stack>
        <MetricsRow metrics={layout?.metrics} loading={loading} />
      </Stack>

      <Box sx={{ position: 'relative', px: 1.5, pt: 1.5, pb: 2 }}>
        {error ? (
          <Typography sx={{ color: theme.palette.error.light, fontSize: '0.85rem', p: 2 }}>{error}</Typography>
        ) : loading && !payload ? (
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 6, justifyContent: 'center' }}>
            <CircularProgress size={20} />
            <Typography sx={{ color: alpha(theme.palette.common.white, 0.6) }}>Loading scatter…</Typography>
          </Stack>
        ) : !layout ? (
          <Typography sx={{ color: alpha(theme.palette.common.white, 0.6), fontSize: '0.85rem', p: 4, textAlign: 'center' }}>
            No paired (predicted, observed) data for this model yet. Once the model has predictions for at least two harvested
            field-seasons, the scatter will populate here.
          </Typography>
        ) : (
          <PlotSvg
            layout={layout}
            theme={theme}
            onHover={setHoverPoint}
            hoverPoint={hoverPoint}
            onPointClick={(p) => setDrawerFieldSeasonId(p.field_season_id)}
          />
        )}
        {hoverPoint && layout ? <HoverChip point={hoverPoint} theme={theme} /> : null}
      </Box>

      {/* Footer — regression equation + the legend. Keeps the chart
          self-explanatory without crowding the plot area. */}
      {layout ? (
        <Stack
          direction="row"
          sx={{
            px: 2.5,
            py: 1.25,
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: `1px solid ${alpha(theme.palette.primary.main, 0.18)}`,
            flexWrap: 'wrap',
            gap: 1
          }}
        >
          <Typography sx={{ color: alpha(theme.palette.common.white, 0.7), fontSize: '0.78rem', fontFamily: 'monospace' }}>
            {layout.metrics?.slope != null && layout.metrics?.intercept != null
              ? `Fit:  predicted ≈ ${layout.metrics.slope.toFixed(3)} · observed ${
                  layout.metrics.intercept >= 0 ? '+' : '−'
                } ${Math.abs(layout.metrics.intercept).toFixed(2)} bu/ac`
              : 'Fit unavailable'}
          </Typography>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
            <LegendSwatch
              color={theme.palette.info.light}
              label="Under-predicted"
              tooltip="Points below the 1:1 line. The model came in lower than the actual harvest."
            />
            <LegendSwatch
              color={theme.palette.warning.light}
              label="Over-predicted"
              tooltip="Points above the 1:1 line. The model came in higher than the actual harvest."
            />
            <LegendLine kind="dashed" label="1:1 (perfect)" theme={theme} />
            <LegendLine kind="solid" label="OLS fit" theme={theme} />
          </Stack>
        </Stack>
      ) : null}

      {/* Detail drawer — opens when a scatter point is clicked. The drawer
          is a modal overlay (MUI Drawer), so it floats over the whole
          page rather than displacing the card layout. fieldSeasonId
          drives open/closed; passing null closes it.
          ---
          We pass the card's `models` list (already filtered to remove
          Deep Learning at line 142) plus the active `selectedId`. The
          drawer's predictions section uses `selectedModelId` to filter
          its predictions array, so the user sees ONLY the CatBoost
          prediction for the clicked field-season — never the Deep
          Learning one. The drawer's model picker stays in sync with
          this card via onModelChange, so swapping models in either
          place updates the other. */}
      <FieldDetailDrawer
        fieldSeasonId={drawerFieldSeasonId}
        onClose={() => setDrawerFieldSeasonId(null)}
        availableModels={models}
        selectedModelId={selectedId && selectedId > 0 ? selectedId : null}
        onModelChange={setSelectedId}
      />
    </Paper>
  );
}

// Themed tooltip slot props — matches the blue-tinted "Deep-Learning-pill"
// family used in Overview.jsx so every help-tooltip on the page reads as
// part of the same surface family instead of the default MUI gray.
function useThemedTooltipSlotProps() {
  const theme = useTheme();
  return {
    tooltip: {
      sx: {
        bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})`,
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
        color: `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})`,
        '&::before': {
          border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
          backgroundColor: `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})`
        }
      }
    }
  };
}

function MetricsRow({ metrics, loading }) {
  const theme = useTheme();
  const tooltipSlotProps = useThemedTooltipSlotProps();
  if (loading && !metrics) return null;
  const items = [
    {
      label: 'R²',
      value: metrics?.r2,
      fmt: (v) => v.toFixed(3),
      tooltip: 'Coefficient of determination. 1.0 is perfect; 0 means the model is no better than predicting the mean.'
    },
    {
      label: 'RMSE',
      value: metrics?.rmse,
      fmt: (v) => v.toFixed(2),
      unit: 'bu/ac',
      tooltip: 'Root mean squared error. Same units as yield; penalizes big misses more than small ones.'
    },
    {
      label: 'MAE',
      value: metrics?.mae,
      fmt: (v) => v.toFixed(2),
      unit: 'bu/ac',
      tooltip: 'Mean absolute error. Average size of the prediction error, ignoring direction.'
    },
    {
      label: 'Bias',
      value: metrics?.bias,
      fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`,
      unit: 'bu/ac',
      tooltip: 'Mean residual (predicted − observed). Positive = model systematically over-predicts; negative = under-predicts.'
    },
    {
      label: 'n',
      value: metrics?.n,
      fmt: (v) => v.toLocaleString(),
      tooltip: 'Number of field-seasons with both a stored prediction and an observed yield.'
    }
  ];
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.75 }}>
      {items.map((it) => (
        <Tooltip key={it.label} arrow placement="top" title={it.tooltip} slotProps={tooltipSlotProps}>
          <Stack
            direction="row"
            spacing={0.5}
            sx={{
              alignItems: 'baseline',
              px: 1,
              py: 0.35,
              borderRadius: 999,
              bgcolor: alpha(theme.palette.primary.main, 0.22),
              border: `1px solid ${alpha(theme.palette.primary.main, 0.4)}`,
              cursor: 'help'
            }}
          >
            <Typography
              sx={{
                color: alpha(theme.palette.common.white, 0.6),
                fontSize: '0.7rem',
                fontWeight: 600,
                letterSpacing: '0.05em',
                textTransform: 'uppercase'
              }}
            >
              {it.label}
            </Typography>
            <Typography
              sx={{ color: theme.palette.common.white, fontSize: '0.85rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
            >
              {Number.isFinite(it.value) ? it.fmt(it.value) : '—'}
            </Typography>
            {it.unit ? (
              <Typography sx={{ color: alpha(theme.palette.common.white, 0.55), fontSize: '0.7rem' }}>{it.unit}</Typography>
            ) : null}
          </Stack>
        </Tooltip>
      ))}
    </Stack>
  );
}

// Pill-style dropdown used for the season + state filters. Matches the
// model-picker styling so the three controls in the header read as one
// family, with a subtle accent border when the filter is active.
function FilterPill({ label, active, anchor, setAnchor, options, selectedValue, onSelect, theme }) {
  return (
    <>
      <Button
        size="small"
        onClick={(e) => setAnchor(e.currentTarget)}
        endIcon={<DownOutlined style={{ fontSize: '0.62rem' }} />}
        sx={{
          textTransform: 'none',
          fontWeight: 600,
          fontSize: '0.78rem',
          minHeight: 0,
          py: 0.2,
          px: 1.1,
          borderRadius: 999,
          color: active ? theme.palette.common.white : alpha(theme.palette.common.white, 0.7),
          bgcolor: active ? alpha(theme.palette.primary.main, 0.3) : alpha(theme.palette.primary.main, 0.1),
          border: `1px solid ${alpha(theme.palette.primary.main, active ? 0.6 : 0.32)}`,
          '&:hover': {
            color: theme.palette.common.white,
            bgcolor: alpha(theme.palette.primary.main, 0.24),
            borderColor: theme.palette.primary.main
          }
        }}
      >
        {label}
      </Button>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        slotProps={{
          paper: {
            sx: {
              bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 8%, ${theme.palette.background.paper})`,
              border: `1px solid ${alpha(theme.palette.primary.main, 0.32)}`,
              borderRadius: 1.25,
              mt: 0.5,
              maxHeight: 360,
              '& .MuiMenuItem-root': {
                color: alpha(theme.palette.common.white, 0.88),
                fontSize: '0.85rem',
                minHeight: 32,
                '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.16) },
                '&.Mui-selected': {
                  bgcolor: alpha(theme.palette.primary.main, 0.24),
                  '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.32) }
                }
              }
            }
          }
        }}
      >
        {options.map((opt) => (
          <MenuItem
            key={`${opt.label}-${opt.value ?? 'all'}`}
            selected={selectedValue === opt.value}
            onClick={() => {
              onSelect(opt.value);
              setAnchor(null);
            }}
          >
            {opt.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function LegendSwatch({ color, label, tooltip }) {
  const theme = useTheme();
  const tooltipSlotProps = useThemedTooltipSlotProps();
  return (
    <Tooltip arrow placement="top" title={tooltip || ''} slotProps={tooltipSlotProps}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', cursor: tooltip ? 'help' : 'default' }}>
        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color, boxShadow: `0 0 6px ${alpha(color, 0.6)}` }} />
        <Typography sx={{ color: alpha(theme.palette.common.white, 0.7), fontSize: '0.74rem', fontWeight: 600 }}>{label}</Typography>
      </Stack>
    </Tooltip>
  );
}

function LegendLine({ kind, label, theme }) {
  const dashed = kind === 'dashed';
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <Box component="svg" viewBox="0 0 20 8" sx={{ width: 20, height: 8 }}>
        <line
          x1={0}
          y1={4}
          x2={20}
          y2={4}
          stroke={dashed ? alpha(theme.palette.common.white, 0.55) : theme.palette.primary.light}
          strokeWidth={dashed ? 1.4 : 2}
          strokeDasharray={dashed ? '3 3' : ''}
        />
      </Box>
      <Typography sx={{ color: alpha(theme.palette.common.white, 0.7), fontSize: '0.74rem', fontWeight: 600 }}>{label}</Typography>
    </Stack>
  );
}

function PlotSvg({ layout, theme, onHover, hoverPoint, onPointClick }) {
  const svgRef = useRef(null);
  const { min, max, xScale, yScale, scatter, fitted, xTicks } = layout;
  // y ticks reuse the x tick set since the axes share a domain. Keeping
  // the grids square also reinforces the "1:1 is the diagonal" framing.
  const yTicks = xTicks;
  const axisColor = alpha(theme.palette.common.white, 0.4);
  const gridColor = alpha(theme.palette.primary.main, 0.18);
  const textColor = alpha(theme.palette.common.white, 0.7);

  return (
    <Box
      component="svg"
      ref={svgRef}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid meet"
      sx={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
      onMouseLeave={() => onHover(null)}
    >
      {/* Grid */}
      {xTicks.map((t, i) => (
        <line key={`gx-${i}`} x1={xScale(t)} x2={xScale(t)} y1={MARGIN.top} y2={MARGIN.top + PLOT_H} stroke={gridColor} strokeWidth={1} />
      ))}
      {yTicks.map((t, i) => (
        <line key={`gy-${i}`} x1={MARGIN.left} x2={MARGIN.left + PLOT_W} y1={yScale(t)} y2={yScale(t)} stroke={gridColor} strokeWidth={1} />
      ))}

      {/* 1:1 reference line — dashed, drawn before the fitted line so
          the fit reads as the dominant signal. */}
      <line
        x1={xScale(min)}
        y1={yScale(min)}
        x2={xScale(max)}
        y2={yScale(max)}
        stroke={alpha(theme.palette.common.white, 0.5)}
        strokeWidth={1.5}
        strokeDasharray="6 5"
      />

      {/* Fitted OLS line */}
      {fitted ? (
        <line
          x1={xScale(fitted[0].x)}
          y1={yScale(fitted[0].y)}
          x2={xScale(fitted[1].x)}
          y2={yScale(fitted[1].y)}
          stroke={theme.palette.primary.light}
          strokeWidth={2.5}
          opacity={0.95}
        />
      ) : null}

      {/* Points — clicking opens the FieldDetailDrawer (same surface the
          Overview chevron / FieldTable row-click opens), so users can
          drill into the full history for a flagged outlier without
          leaving the chart. */}
      {scatter.map((p) => (
        <circle
          key={p.field_season_id}
          cx={p.cx}
          cy={p.cy}
          r={hoverPoint?.field_season_id === p.field_season_id ? 6.5 : 4}
          fill={p.fill}
          stroke={alpha(theme.palette.common.black, 0.45)}
          strokeWidth={0.8}
          opacity={0.85}
          style={{ cursor: 'pointer', transition: 'r 0.12s ease' }}
          onMouseEnter={() => onHover(p)}
          onClick={() => onPointClick && onPointClick(p)}
        />
      ))}

      {/* Axes */}
      <line
        x1={MARGIN.left}
        x2={MARGIN.left + PLOT_W}
        y1={MARGIN.top + PLOT_H}
        y2={MARGIN.top + PLOT_H}
        stroke={axisColor}
        strokeWidth={1}
      />
      <line x1={MARGIN.left} x2={MARGIN.left} y1={MARGIN.top} y2={MARGIN.top + PLOT_H} stroke={axisColor} strokeWidth={1} />

      {/* Tick labels */}
      {xTicks.map((t, i) => (
        <text key={`xt-${i}`} x={xScale(t)} y={MARGIN.top + PLOT_H + 18} fill={textColor} fontSize={12} textAnchor="middle">
          {t}
        </text>
      ))}
      {yTicks.map((t, i) => (
        <text key={`yt-${i}`} x={MARGIN.left - 10} y={yScale(t) + 4} fill={textColor} fontSize={12} textAnchor="end">
          {t}
        </text>
      ))}

      {/* Axis titles */}
      <text
        x={MARGIN.left + PLOT_W / 2}
        y={VIEW_H - 14}
        fill={alpha(theme.palette.common.white, 0.85)}
        fontSize={13}
        fontWeight={600}
        textAnchor="middle"
      >
        Observed yield (bu/ac)
      </text>
      <text
        transform={`translate(18, ${MARGIN.top + PLOT_H / 2}) rotate(-90)`}
        fill={alpha(theme.palette.common.white, 0.85)}
        fontSize={13}
        fontWeight={600}
        textAnchor="middle"
      >
        Predicted yield (bu/ac)
      </text>
    </Box>
  );
}

function HoverChip({ point, theme }) {
  const residual = Number.isFinite(point.residual) ? point.residual : 0;
  const sign = residual >= 0 ? '+' : '−';
  return (
    <Box
      sx={{
        position: 'absolute',
        top: 12,
        right: 16,
        minWidth: 200,
        bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 22%, ${theme.palette.background.paper})`,
        border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
        borderRadius: 1.5,
        boxShadow: `0 6px 16px ${alpha(theme.palette.common.black, 0.45)}`,
        px: 1.5,
        py: 1,
        pointerEvents: 'none'
      }}
    >
      <Typography
        sx={{
          color: alpha(theme.palette.common.white, 0.5),
          fontSize: '0.66rem',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase'
        }}
      >
        Field {point.field_number}
        {point.state ? ` · ${point.state}` : ''}
        {point.season_year ? ` · ${point.season_year}` : ''}
      </Typography>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'baseline', mt: 0.25 }}>
        <Stack spacing={0}>
          <Typography sx={{ color: alpha(theme.palette.common.white, 0.6), fontSize: '0.66rem' }}>Observed</Typography>
          <Typography sx={{ color: theme.palette.common.white, fontWeight: 700, fontSize: '0.95rem', fontVariantNumeric: 'tabular-nums' }}>
            {point.observed.toFixed(1)}
          </Typography>
        </Stack>
        <Stack spacing={0}>
          <Typography sx={{ color: alpha(theme.palette.common.white, 0.6), fontSize: '0.66rem' }}>Predicted</Typography>
          <Typography sx={{ color: theme.palette.common.white, fontWeight: 700, fontSize: '0.95rem', fontVariantNumeric: 'tabular-nums' }}>
            {point.predicted.toFixed(1)}
          </Typography>
        </Stack>
        <Stack spacing={0}>
          <Typography sx={{ color: alpha(theme.palette.common.white, 0.6), fontSize: '0.66rem' }}>Residual</Typography>
          <Typography
            sx={{
              color: residual >= 0 ? theme.palette.warning.light : theme.palette.info.light,
              fontWeight: 700,
              fontSize: '0.95rem',
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {sign}
            {Math.abs(residual).toFixed(1)}
          </Typography>
        </Stack>
      </Stack>
      <Typography
        sx={{
          color: alpha(theme.palette.common.white, 0.5),
          fontSize: '0.66rem',
          mt: 0.5,
          fontStyle: 'italic'
        }}
      >
        Click for full field-season detail
      </Typography>
    </Box>
  );
}
