// Residual Diagnostics card for the Model & Data view. Renders two
// vertically-stacked charts driven by the same /predict/scatter payload
// that powers the Predicted-vs-Observed card:
//
//   1. Residuals vs observed yield — scatter of (predicted − observed)
//      against the observed yield. A flat cloud around y=0 means the
//      model is well-calibrated across the yield range; a downward
//      trend is the classic "compressed predictions" pattern where the
//      model over-predicts low yields and under-predicts high ones.
//
//   2. Residual distribution — histogram of (predicted − observed). An
//      unbiased model centers on zero. The red marker shows the mean
//      residual; large offsets signal systematic over- or
//      under-prediction. Bin widths use the Freedman–Diaconis rule.
//
// The card is intentionally a sibling of ModelRegressionCard rather than
// a child, so it can be laid out independently. Its filter pills mirror
// the ones in ModelRegressionCard (model / season / state); they're kept
// local to this card so the two views can be sliced independently when
// useful (e.g. zoom the regression on Kansas while keeping the residual
// view broad).

import { useEffect, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';
import AreaChartOutlined from '@ant-design/icons/AreaChartOutlined';
import DownOutlined from '@ant-design/icons/DownOutlined';
import TableOutlined from '@ant-design/icons/TableOutlined';

// CoverageScopeSelector import removed — card is pinned to the cleaned
// training envelope and no longer surfaces tier toggles.
import FieldDetailDrawer from 'sections/intelligence/crop-studio/FieldDetailDrawer';
import PredictionsTable from 'sections/intelligence/crop-studio/PredictionsTable';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

// Plot geometry. The viewBox is ~2.3:1 so each chart reads as a wide
// panel rather than a square. The SVG sizes to width: 100%, height:
// auto — desktop renders large enough to read individual points,
// mobile scales down cleanly. Sized at 1200×520: gives the residuals
// scatter and histogram enough vertical real estate to read at a
// glance without making the card a long scroll (two charts stack in
// this card, so each height roughly doubles the card's total chart
// area).
const VIEW_W = 1200;
const VIEW_H = 520;
const MARGIN = { top: 28, right: 28, bottom: 56, left: 76 };
const PLOT_W = VIEW_W - MARGIN.left - MARGIN.right;
const PLOT_H = VIEW_H - MARGIN.top - MARGIN.bottom;

// Same display-name + model-type predicates the regression card uses, kept
// in sync so the dropdown shows the same friendly labels.
function getModelDisplayName(modelType, fallbackTag) {
  const key = String(modelType || '').toLowerCase();
  if (key.includes('deep') || key.includes('pytorch') || key.includes('neural')) return 'Deep Learning';
  if (key.includes('catboost') || key.includes('lgbm') || key.includes('lightgbm') || key.includes('boost')) return 'CatBoost';
  if (key.includes('forest') || key.includes('tree')) return 'Random Forest';
  if (key.includes('xgb')) return 'XGBoost';
  return modelType || fallbackTag || 'Unknown';
}

function isDeepLearning(model) {
  const key = String(model?.model_type || '').toLowerCase();
  return key.includes('deep') || key.includes('pytorch') || key.includes('neural');
}

function isCatBoost(model) {
  const key = String(model?.model_type || '').toLowerCase();
  return key.includes('catboost') || key.includes('lgbm') || key.includes('lightgbm') || key.includes('boost');
}

// Axis-tick "nice step" — snaps to {1, 2, 5} × 10^k so the labels read as
// clean round numbers regardless of data scale. Mirrors the regression
// card's helper so the two charts look stylistically identical.
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

// Themed tooltip styling — matches the rest of the Analytics view family.
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

export default function ResidualDiagnosticsCard() {
  const theme = useTheme();
  const [models, setModels] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modelMenuAnchor, setModelMenuAnchor] = useState(null);
  const [seasonMenuAnchor, setSeasonMenuAnchor] = useState(null);
  const [stateMenuAnchor, setStateMenuAnchor] = useState(null);
  // coverageMenuAnchor used to back the secondary filter-bar pill —
  // not needed now that CoverageScopeSelector renders the prominent
  // ToggleButtonGroup above the metrics.
  // View mode — Chart/Table toggle in the header's Zone 1. Independent
  // from ModelRegressionCard's viewMode so the user can compare one
  // card's chart view against the other's table view if useful.
  const [viewMode, setViewMode] = useState('chart');
  const [seasonFilter, setSeasonFilter] = useState([]);
  const [stateFilter, setStateFilter] = useState(null);
  // Coverage scope is pinned to 'in_envelope' so this card mirrors the
  // ModelRegressionCard's scope (the cleaned training envelope —
  // ~1,002 wheat field-seasons). The CoverageScopeSelector was removed
  // when the team scoped Model & Data to the envelope only. Restore the
  // useState + selector below if multi-tier comparison ever returns.
  const coverageScope = 'in_envelope';
  // Hover state for the live-data readout on the residuals scatter.
  const [hoverPoint, setHoverPoint] = useState(null);
  // Drawer state — clicking a point opens the FieldDetailDrawer (same
  // one the Overview chevron / FieldTable row-click opens).
  const [drawerFieldSeasonId, setDrawerFieldSeasonId] = useState(null);

  // Pull the registered model versions for the dropdown. Deep Learning is
  // filtered out (same reason as the main regression card — its predictions
  // are unreliable on merged inputs and this view is scoped to the tree-
  // family models).
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
        setModelsResolved(true);
      });
    return () => controller.abort();
  }, []);

  // Default selection — production CatBoost if available, else the first
  // CatBoost, else the first production model, else the first model. A
  // sentinel of 0 means "let the backend resolve to the production default".
  useEffect(() => {
    if (!modelsResolved || selectedId !== null) return;
    if (models.length === 0) {
      setSelectedId(0);
      return;
    }
    const preferred =
      models.find((m) => m.is_production && isCatBoost(m)) || models.find(isCatBoost) || models.find((m) => m.is_production) || models[0];
    setSelectedId(preferred.model_version_id);
  }, [modelsResolved, models, selectedId]);

  // Fetch scatter data whenever the selected model or filters change.
  useEffect(() => {
    if (selectedId === null) return;
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (selectedId > 0) params.append('model_id', String(selectedId));
    for (const year of seasonFilter) params.append('season', String(year));
    if (stateFilter) params.append('state', stateFilter);
    params.append('coverage_scope', coverageScope);
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
        if (selectedId === 0 && p?.model_version?.model_version_id) {
          setSelectedId(p.model_version.model_version_id);
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message || 'Failed to load scatter data.');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [selectedId, seasonFilter, stateFilter, coverageScope]);

  // Memoize the points array so the two chart components don't recompute
  // their geometry every render.
  const points = useMemo(() => {
    const arr = Array.isArray(payload?.points) ? payload.points : [];
    // Filter out any point with non-finite numbers — defensive against API drift.
    return arr.filter(
      (p) => Number.isFinite(p?.observed) && Number.isFinite(p?.predicted) && Number.isFinite(p?.residual)
    );
  }, [payload]);

  const metrics = payload?.metrics || {};

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
      {/* Header — three stratified zones mirroring ModelRegressionCard's
          layout so the two cards read as a connected pair. The hero
          metric is *Bias* here (not R²) because the diagnostic value of
          this card is asking "is the model systematically wrong?" — Bias
          answers that directly. RMSE / MAE / n provide the magnitude
          and sample size in the secondary line. */}
      <Stack
        sx={{
          px: 2.5,
          py: 1.5,
          borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.18)}`,
          gap: 1.25
        }}
      >
        {/* ============== Zone 1 — Identity + View Toggle ============== */}
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}
        >
          <Typography
            sx={{
              fontWeight: 700,
              fontSize: '1.05rem',
              color: theme.palette.common.white,
              letterSpacing: '0.01em',
              lineHeight: 1.2
            }}
          >
            Residual Diagnostics
          </Typography>
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            size="small"
            onChange={(_, next) => {
              if (next) setViewMode(next);
            }}
            sx={{
              '& .MuiToggleButtonGroup-grouped': { borderRadius: 1.25 },
              '& .MuiToggleButton-root': {
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '0.78rem',
                letterSpacing: '0.01em',
                color: alpha(theme.palette.common.white, 0.7),
                bgcolor: alpha(theme.palette.primary.main, 0.1),
                border: `1px solid ${alpha(theme.palette.primary.main, 0.4)}`,
                px: 1.25,
                py: 0.4,
                gap: 0.6,
                lineHeight: 1.2,
                transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease',
                '&:hover': {
                  bgcolor: alpha(theme.palette.primary.main, 0.18),
                  color: theme.palette.common.white,
                  borderColor: alpha(theme.palette.primary.main, 0.6)
                },
                '&.Mui-selected': {
                  bgcolor: alpha(theme.palette.primary.main, 0.32),
                  color: theme.palette.common.white,
                  borderColor: theme.palette.primary.main,
                  '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.4) }
                }
              }
            }}
          >
            <ToggleButton value="chart" aria-label="Chart view">
              <AreaChartOutlined style={{ fontSize: '0.85rem' }} />
              Chart
            </ToggleButton>
            <ToggleButton value="table" aria-label="Table view">
              <TableOutlined style={{ fontSize: '0.85rem' }} />
              Table
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        {/* Zone 2 (coverage-scope selector) intentionally omitted —
            this card mirrors ModelRegressionCard's pinned scope
            (cleaned training envelope; ~1,002 wheat field-seasons). */}

        {/* ============== Zone 3 — Outputs (metrics) ============== */}
        <HeaderMetrics
          metrics={metrics}
          loading={loading}
          theme={theme}
          hero={{
            label: 'Bias',
            value: metrics?.bias,
            fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`,
            unit: 'bu/ac',
            tooltip:
              'Mean residual (predicted − observed). Positive = model systematically over-predicts; negative = under-predicts. ' +
              'A residual diagnostic card centers on this number — it tells you whether the model is calibrated or skewed.'
          }}
          secondary={[
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
              label: 'n',
              value: metrics?.n,
              fmt: (v) => v.toLocaleString(),
              tooltip: 'Number of field-seasons with both a stored prediction and an observed yield.'
            }
          ]}
        />

        <Divider sx={{ borderColor: alpha(theme.palette.primary.main, 0.18), my: 0.25 }} />

        {/* ============== Zone 3 — Inputs (filter bar) ============== */}
        <Stack
          direction="row"
          sx={{ alignItems: 'center', flexWrap: 'wrap', columnGap: 1, rowGap: 0.75 }}
        >
          <Typography
            sx={{
              color: alpha(theme.palette.common.white, 0.5),
              fontSize: '0.68rem',
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              pr: 0.25
            }}
          >
            Filters
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

          {/* Coverage scope moved out of the secondary filter bar into
              its own prominent row above the metrics. The filter bar
              now only holds Season / State / Model — refinements
              within the chosen scope, not the scope itself. */}

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
      </Stack>

      <Box sx={{ position: 'relative', px: 1.5, pt: 1.5, pb: 2 }}>
        {error ? (
          <Typography sx={{ color: theme.palette.error.light, fontSize: '0.85rem', p: 2 }}>{error}</Typography>
        ) : loading && !payload ? (
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 8, justifyContent: 'center' }}>
            <CircularProgress size={22} />
            <Typography sx={{ color: alpha(theme.palette.common.white, 0.6) }}>Loading residuals…</Typography>
          </Stack>
        ) : points.length === 0 ? (
          <Typography sx={{ color: alpha(theme.palette.common.white, 0.6), fontSize: '0.85rem', p: 4, textAlign: 'center' }}>
            No paired (predicted, observed) data for this model yet. Once the model has predictions for at least two harvested
            field-seasons, the residual diagnostics will populate here.
          </Typography>
        ) : viewMode === 'table' ? (
          // Per-row residual table — same data backing the charts, but
          // sorted by |residual| desc so the biggest misses bubble up.
          // This is the diagnostic complement of the chart's two-up view:
          // the chart shows the pattern, the table names the specific
          // field-seasons driving it.
          <PredictionsTable
            points={points}
            rmse={metrics?.rmse}
            theme={theme}
            onRowClick={(p) => setDrawerFieldSeasonId(p.field_season_id)}
            emptyMessage="No paired (predicted, observed) data for this model yet."
          />
        ) : (
          <Stack spacing={2}>
            <Box sx={{ position: 'relative' }}>
              <ResidualsByYieldSvg
                points={points}
                theme={theme}
                hoverPoint={hoverPoint}
                onHover={setHoverPoint}
                onPointClick={(p) => setDrawerFieldSeasonId(p.field_season_id)}
              />
              {hoverPoint ? <ResidualHoverChip point={hoverPoint} theme={theme} /> : null}
              <Typography
                sx={{
                  color: alpha(theme.palette.common.white, 0.65),
                  fontSize: '0.78rem',
                  px: 1,
                  mt: 0.75,
                  fontStyle: 'italic'
                }}
              >
                A downward trend means the model over-predicts low yields and under-predicts high ones — the
                &quot;compressed predictions&quot; pattern that signals the model can&apos;t extrapolate well past its
                training range.
              </Typography>
            </Box>

            {/* Subtle divider between the two diagnostic charts. Uses the
                same primary-tint family as the card's borders so it reads
                as part of the surface, not a hard separator. mx/my give it
                breathing room from the chart content above and below. */}
            <Box
              sx={{
                height: '1px',
                bgcolor: alpha(theme.palette.primary.main, 0.18),
                mx: 1,
                my: 0.5
              }}
            />

            <Box>
              <ResidualDistributionSvg points={points} metrics={metrics} theme={theme} />
              <Typography
                sx={{
                  color: alpha(theme.palette.common.white, 0.65),
                  fontSize: '0.78rem',
                  px: 1,
                  mt: 0.75,
                  fontStyle: 'italic'
                }}
              >
                An unbiased model centers its residuals on zero. The red line is the mean residual — a large
                offset means the model systematically over- or under-predicts.
              </Typography>
            </Box>
          </Stack>
        )}
      </Box>

      {/* Field-season detail drawer — opens when a residual point is
          clicked. Reuses the same surface the FieldTable / Overview
          chevron opens, so the data fetched and rendered there is
          consistent across every entry point.
          ---
          We pass the card's `models` list (Deep Learning already
          filtered out at load time) plus the active `selectedId`. The
          drawer filters its predictions by `selectedModelId`, so the
          user only sees the CatBoost prediction for the clicked
          field-season. onModelChange keeps the drawer's model picker
          and this card's selector in sync. */}
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

// Header metrics — mirrors ModelRegressionCard's HeaderMetrics
// line-for-line so the two cards present metrics in the same visual
// rhythm. Bias is the primary metric here (it's the diagnostic
// question this card answers); RMSE / MAE / n are supporting.
function HeaderMetrics({ metrics, loading, theme, hero, secondary }) {
  const tooltipSlotProps = useThemedTooltipSlotProps();
  if (loading && !metrics) return null;

  const items = [
    { ...hero, isPrimary: true },
    ...secondary.map((s) => ({ ...s, isPrimary: false }))
  ];

  return (
    <Stack
      direction="row"
      sx={{
        alignItems: 'baseline',
        flexWrap: 'wrap',
        columnGap: 1.25,
        rowGap: 0.65
      }}
    >
      {items.map((item, idx) => {
        const finite = Number.isFinite(item.value);
        const display = finite ? item.fmt(item.value) : '—';
        return (
          <Stack key={item.label} direction="row" spacing={0.65} sx={{ alignItems: 'baseline' }}>
            {idx > 0 ? (
              <Typography
                aria-hidden
                sx={{
                  color: alpha(theme.palette.common.white, 0.28),
                  fontSize: '0.9rem',
                  px: 0.15,
                  userSelect: 'none',
                  lineHeight: 1
                }}
              >
                ·
              </Typography>
            ) : null}
            <Tooltip arrow placement="top" title={item.tooltip} slotProps={tooltipSlotProps}>
              <Stack direction="row" spacing={0.55} sx={{ alignItems: 'baseline', cursor: 'help' }}>
                <Typography
                  sx={{
                    color: item.isPrimary
                      ? alpha(theme.palette.primary.light, 0.95)
                      : alpha(theme.palette.common.white, 0.55),
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    letterSpacing: item.isPrimary ? '0.1em' : '0.05em',
                    textTransform: 'uppercase'
                  }}
                >
                  {item.label}
                </Typography>
                <Typography
                  sx={{
                    color: theme.palette.common.white,
                    fontSize: item.isPrimary ? '1.05rem' : '0.95rem',
                    fontWeight: item.isPrimary ? 800 : 700,
                    fontVariantNumeric: 'tabular-nums',
                    lineHeight: 1.15
                  }}
                >
                  {display}
                </Typography>
                {item.unit ? (
                  <Typography
                    sx={{
                      color: alpha(theme.palette.common.white, 0.45),
                      fontSize: '0.7rem',
                      fontWeight: 500
                    }}
                  >
                    {item.unit}
                  </Typography>
                ) : null}
              </Stack>
            </Tooltip>
          </Stack>
        );
      })}
    </Stack>
  );
}

// Reused filter-pill — same shape as the regression card's so the two
// cards' header controls read as a single visual family.
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

// =========================================================================
// Chart 1 — Residuals vs Observed Yield
// =========================================================================
// Scatter of (predicted − observed) against observed. y-axis is symmetric
// around zero so the y=0 reference line sits at the visual center. Points
// retain the over- / under-prediction color coding used by the main
// regression card. An OLS trend line through the residuals exposes any
// systematic miscalibration across the yield range.
function ResidualsByYieldSvg({ points, theme, hoverPoint, onHover, onPointClick }) {
  const tooltipSlotProps = useThemedTooltipSlotProps();

  const layout = useMemo(() => {
    if (!points || points.length === 0) return null;

    const observed = points.map((p) => p.observed);
    const residuals = points.map((p) => p.residual);

    const xRawMin = Math.min(...observed);
    const xRawMax = Math.max(...observed);
    const xPad = (xRawMax - xRawMin) * 0.04 || 1;
    const xStep = niceStep(xRawMax - xRawMin + 2 * xPad);
    const xMin = Math.floor((xRawMin - xPad) / xStep) * xStep;
    const xMax = Math.ceil((xRawMax + xPad) / xStep) * xStep;

    const yAbs = Math.max(...residuals.map((r) => Math.abs(r))) || 1;
    const yStep = niceStep(2 * yAbs);
    const yMax = Math.ceil(yAbs / yStep) * yStep;
    const yMin = -yMax;

    const xScale = (v) => MARGIN.left + ((v - xMin) / (xMax - xMin)) * PLOT_W;
    const yScale = (v) => MARGIN.top + PLOT_H - ((v - yMin) / (yMax - yMin)) * PLOT_H;

    // OLS fit of residual on observed yield.
    const n = points.length;
    const obsMean = observed.reduce((a, b) => a + b, 0) / n;
    const resMean = residuals.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i += 1) {
      num += (observed[i] - obsMean) * (residuals[i] - resMean);
      den += (observed[i] - obsMean) ** 2;
    }
    const slope = den > 0 ? num / den : 0;
    const intercept = resMean - slope * obsMean;

    const xTicks = generateTicks(xMin, xMax);
    const yTicks = generateTicks(yMin, yMax);

    return { xMin, xMax, yMin, yMax, xScale, yScale, slope, intercept, xTicks, yTicks };
  }, [points]);

  if (!layout) return null;

  const { xMin, xMax, yMin, yMax, xScale, yScale, slope, intercept, xTicks, yTicks } = layout;
  const axisColor = alpha(theme.palette.common.white, 0.4);
  const gridColor = alpha(theme.palette.primary.main, 0.18);
  const textColor = alpha(theme.palette.common.white, 0.75);

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', px: 1, mb: 0.5 }}>
        <Typography
          sx={{
            color: alpha(theme.palette.common.white, 0.85),
            fontSize: '0.85rem',
            fontWeight: 700,
            letterSpacing: '0.02em'
          }}
        >
          Residuals vs observed yield
        </Typography>
        <Tooltip
          arrow
          placement="top"
          title="OLS regression slope of residual on observed yield. 0 = unbiased across the range; negative = compressed predictions."
          slotProps={tooltipSlotProps}
        >
          <Typography
            sx={{
              color: alpha(theme.palette.primary.light, 0.95),
              fontSize: '0.78rem',
              fontFamily: 'monospace',
              cursor: 'help'
            }}
          >
            trend slope = {slope.toFixed(3)} bu/ac per bu/ac
          </Typography>
        </Tooltip>
      </Stack>
      <Box
        component="svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        // maxHeight caps each chart at 600px on extra-wide displays so
        // the two stacked panels don't grow unbounded on 1600px+
        // viewports. Set above the natural VIEW_H (520) so the cap
        // only kicks in once the container is wider than ~1385px — at
        // narrower widths the chart sizes proportionally via
        // width:100% / height:auto. The previous 420 cap was actually
        // clipping the chart at typical desktop widths since it was
        // below the natural rendered height.
        sx={{ width: '100%', height: 'auto', maxHeight: 600, display: 'block', overflow: 'visible' }}
        onMouseLeave={() => onHover && onHover(null)}
      >
        {/* Grid */}
        {xTicks.map((t, i) => (
          <line
            key={`gx-${i}`}
            x1={xScale(t)}
            x2={xScale(t)}
            y1={MARGIN.top}
            y2={MARGIN.top + PLOT_H}
            stroke={gridColor}
            strokeWidth={1}
          />
        ))}
        {yTicks.map((t, i) => (
          <line
            key={`gy-${i}`}
            x1={MARGIN.left}
            x2={MARGIN.left + PLOT_W}
            y1={yScale(t)}
            y2={yScale(t)}
            stroke={gridColor}
            strokeWidth={1}
          />
        ))}

        {/* y=0 reference line */}
        <line
          x1={MARGIN.left}
          x2={MARGIN.left + PLOT_W}
          y1={yScale(0)}
          y2={yScale(0)}
          stroke={alpha(theme.palette.common.white, 0.55)}
          strokeWidth={1.8}
          strokeDasharray="7 5"
        />

        {/* OLS trend through residuals */}
        <line
          x1={xScale(xMin)}
          y1={yScale(slope * xMin + intercept)}
          x2={xScale(xMax)}
          y2={yScale(slope * xMax + intercept)}
          stroke={theme.palette.primary.light}
          strokeWidth={2.8}
          opacity={0.95}
        />

        {/* Points — colored by residual sign for over- vs under-prediction.
            Hovering surfaces a live readout chip; clicking opens the
            FieldDetailDrawer for that field-season. */}
        {points.map((p) => {
          const fill = p.residual >= 0 ? theme.palette.warning.light : theme.palette.info.light;
          const isHovered = hoverPoint?.field_season_id === p.field_season_id;
          return (
            <circle
              key={`r-${p.field_season_id}`}
              cx={xScale(p.observed)}
              cy={yScale(p.residual)}
              r={isHovered ? 7 : 4}
              fill={fill}
              stroke={alpha(theme.palette.common.black, 0.45)}
              strokeWidth={isHovered ? 1 : 0.6}
              opacity={isHovered ? 0.95 : 0.72}
              style={{ cursor: 'pointer', transition: 'r 0.12s ease' }}
              onMouseEnter={() => onHover && onHover(p)}
              onClick={() => onPointClick && onPointClick(p)}
            />
          );
        })}

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
          <text key={`xt-${i}`} x={xScale(t)} y={MARGIN.top + PLOT_H + 22} fill={textColor} fontSize={14} textAnchor="middle">
            {t}
          </text>
        ))}
        {yTicks.map((t, i) => (
          <text key={`yt-${i}`} x={MARGIN.left - 10} y={yScale(t) + 5} fill={textColor} fontSize={14} textAnchor="end">
            {t > 0 ? `+${t}` : t}
          </text>
        ))}

        {/* Axis titles */}
        <text
          x={MARGIN.left + PLOT_W / 2}
          y={VIEW_H - 14}
          fill={alpha(theme.palette.common.white, 0.85)}
          fontSize={15}
          fontWeight={600}
          textAnchor="middle"
        >
          Observed yield (bu/ac)
        </text>
        <text
          transform={`translate(22, ${MARGIN.top + PLOT_H / 2}) rotate(-90)`}
          fill={alpha(theme.palette.common.white, 0.85)}
          fontSize={15}
          fontWeight={600}
          textAnchor="middle"
        >
          Residual: predicted − observed (bu/ac)
        </text>
      </Box>
    </Box>
  );
}

// =========================================================================
// Chart 2 — Residual Distribution
// =========================================================================
// Histogram of residuals. Bin width via Freedman–Diaconis (2·IQR·n^(-1/3))
// with sensible clamps so the histogram doesn't degenerate at tiny samples.
// A dashed vertical at zero marks the "unbiased" reference; the solid red
// line marks the actual mean residual.
function ResidualDistributionSvg({ points, metrics, theme }) {
  const layout = useMemo(() => {
    if (!points || points.length === 0) return null;
    const residuals = points.map((p) => p.residual).filter((r) => Number.isFinite(r));
    const n = residuals.length;
    if (n === 0) return null;

    const minR = Math.min(...residuals);
    const maxR = Math.max(...residuals);
    const range = maxR - minR || 1;

    const sorted = [...residuals].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const fdWidth = iqr > 0 ? (2 * iqr) / Math.cbrt(n) : range / 30;
    const binCount = Math.min(60, Math.max(15, Math.round(range / fdWidth)));
    const binWidth = range / binCount;

    const bins = new Array(binCount).fill(0);
    for (const r of residuals) {
      const idx = Math.min(binCount - 1, Math.max(0, Math.floor((r - minR) / binWidth)));
      bins[idx] += 1;
    }
    const maxBin = Math.max(...bins) || 1;
    const meanResidual = Number.isFinite(metrics?.bias) ? metrics.bias : residuals.reduce((a, b) => a + b, 0) / n;

    const xStep = niceStep(range);
    const xMin = Math.floor(minR / xStep) * xStep;
    const xMax = Math.ceil(maxR / xStep) * xStep;
    const yMax = Math.ceil(maxBin * 1.08);

    const xScale = (v) => MARGIN.left + ((v - xMin) / (xMax - xMin)) * PLOT_W;
    const yScale = (v) => MARGIN.top + PLOT_H - (v / yMax) * PLOT_H;

    const xTicks = generateTicks(xMin, xMax);
    return { bins, binWidth, minR, xMin, xMax, yMax, xScale, yScale, xTicks, meanResidual };
  }, [points, metrics]);

  if (!layout) return null;

  const { bins, binWidth, minR, xMin, xMax, yMax, xScale, yScale, xTicks, meanResidual } = layout;
  const axisColor = alpha(theme.palette.common.white, 0.4);
  const gridColor = alpha(theme.palette.primary.main, 0.18);
  const textColor = alpha(theme.palette.common.white, 0.75);

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', px: 1, mb: 0.5 }}>
        <Typography
          sx={{
            color: alpha(theme.palette.common.white, 0.85),
            fontSize: '0.85rem',
            fontWeight: 700,
            letterSpacing: '0.02em'
          }}
        >
          Residual distribution
        </Typography>
        <Typography
          sx={{
            color: alpha(theme.palette.error.light, 0.95),
            fontSize: '0.78rem',
            fontFamily: 'monospace'
          }}
        >
          mean = {meanResidual >= 0 ? '+' : '−'}
          {Math.abs(meanResidual).toFixed(2)} bu/ac
        </Typography>
      </Stack>
      <Box
        component="svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        // maxHeight caps each chart at 600px on extra-wide displays so
        // the two stacked panels don't grow unbounded on 1600px+
        // viewports. Set above the natural VIEW_H (520) so the cap
        // only kicks in once the container is wider than ~1385px — at
        // narrower widths the chart sizes proportionally via
        // width:100% / height:auto. The previous 420 cap was actually
        // clipping the chart at typical desktop widths since it was
        // below the natural rendered height.
        sx={{ width: '100%', height: 'auto', maxHeight: 600, display: 'block', overflow: 'visible' }}
      >
        {/* Vertical grid at each tick */}
        {xTicks.map((t, i) => (
          <line
            key={`hgx-${i}`}
            x1={xScale(t)}
            x2={xScale(t)}
            y1={MARGIN.top}
            y2={MARGIN.top + PLOT_H}
            stroke={gridColor}
            strokeWidth={1}
          />
        ))}

        {/* Bars */}
        {bins.map((count, i) => {
          const left = minR + i * binWidth;
          const x = xScale(left);
          const w = Math.max(xScale(left + binWidth) - x - 1, 0.5);
          const y = yScale(count);
          const h = MARGIN.top + PLOT_H - y;
          return (
            <rect
              key={`bar-${i}`}
              x={x}
              y={y}
              width={w}
              height={h}
              fill={theme.palette.primary.light}
              opacity={0.82}
              stroke={alpha(theme.palette.common.black, 0.35)}
              strokeWidth={0.5}
            />
          );
        })}

        {/* Zero reference */}
        <line
          x1={xScale(0)}
          x2={xScale(0)}
          y1={MARGIN.top}
          y2={MARGIN.top + PLOT_H}
          stroke={alpha(theme.palette.common.white, 0.55)}
          strokeWidth={1.6}
          strokeDasharray="5 4"
        />

        {/* Mean residual marker (red) */}
        <line
          x1={xScale(meanResidual)}
          x2={xScale(meanResidual)}
          y1={MARGIN.top}
          y2={MARGIN.top + PLOT_H}
          stroke={theme.palette.error.main}
          strokeWidth={2.4}
        />

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

        {/* Tick labels — x */}
        {xTicks.map((t, i) => (
          <text key={`hxt-${i}`} x={xScale(t)} y={MARGIN.top + PLOT_H + 22} fill={textColor} fontSize={14} textAnchor="middle">
            {t > 0 ? `+${t}` : t}
          </text>
        ))}

        {/* y-axis: generate a few integer ticks (counts). */}
        {(() => {
          const step = niceStep(yMax, 5);
          const out = [];
          for (let v = 0; v <= yMax + step * 0.001; v += step) {
            out.push(v);
          }
          return out.map((t, i) => (
            <g key={`hyt-${i}`}>
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + PLOT_W}
                y1={yScale(t)}
                y2={yScale(t)}
                stroke={gridColor}
                strokeWidth={1}
              />
              <text x={MARGIN.left - 10} y={yScale(t) + 5} fill={textColor} fontSize={14} textAnchor="end">
                {Math.round(t)}
              </text>
            </g>
          ));
        })()}

        {/* Axis titles */}
        <text
          x={MARGIN.left + PLOT_W / 2}
          y={VIEW_H - 14}
          fill={alpha(theme.palette.common.white, 0.85)}
          fontSize={15}
          fontWeight={600}
          textAnchor="middle"
        >
          Residual: predicted − observed (bu/ac)
        </text>
        <text
          transform={`translate(22, ${MARGIN.top + PLOT_H / 2}) rotate(-90)`}
          fill={alpha(theme.palette.common.white, 0.85)}
          fontSize={15}
          fontWeight={600}
          textAnchor="middle"
        >
          Count of field-seasons
        </text>
      </Box>
    </Box>
  );
}

// Live readout for the residuals chart — mirrors the HoverChip in the
// regression card so the two cards feel like the same product. Anchored
// to the top-right of the chart's container; the parent passes
// `position: relative` so this absolute positioning lands inside the
// chart card rather than the page.
function ResidualHoverChip({ point, theme }) {
  const residual = Number.isFinite(point.residual) ? point.residual : 0;
  const sign = residual >= 0 ? '+' : '−';
  return (
    <Box
      sx={{
        position: 'absolute',
        top: 36, // clear the chart's title row
        right: 16,
        minWidth: 220,
        bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 22%, ${theme.palette.background.paper})`,
        border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
        borderRadius: 1.5,
        boxShadow: `0 6px 16px ${alpha(theme.palette.common.black, 0.45)}`,
        px: 1.5,
        py: 1,
        pointerEvents: 'none',
        zIndex: 2
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
          <Typography
            sx={{ color: theme.palette.common.white, fontWeight: 700, fontSize: '0.95rem', fontVariantNumeric: 'tabular-nums' }}
          >
            {point.observed.toFixed(1)}
          </Typography>
        </Stack>
        <Stack spacing={0}>
          <Typography sx={{ color: alpha(theme.palette.common.white, 0.6), fontSize: '0.66rem' }}>Predicted</Typography>
          <Typography
            sx={{ color: theme.palette.common.white, fontWeight: 700, fontSize: '0.95rem', fontVariantNumeric: 'tabular-nums' }}
          >
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
