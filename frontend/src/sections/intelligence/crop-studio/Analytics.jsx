import { useEffect, useMemo, useState } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';
import { BarChart } from '@mui/x-charts';
import AppstoreOutlined from '@ant-design/icons/AppstoreOutlined';
import CloseOutlined from '@ant-design/icons/CloseOutlined';
import DownloadOutlined from '@ant-design/icons/DownloadOutlined';
import RightOutlined from '@ant-design/icons/RightOutlined';

import MainCard from 'components/MainCard';
import FieldTable from 'sections/intelligence/crop-studio/FieldTable';
import { formatCropName } from 'utils/cropName';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');
const NUTRIENT_CATEGORIES = ['N (lb/ac)', 'P (lb/ac)', 'K (lb/ac)'];
const YIELD_CATEGORIES = ['Lower CI', 'Predicted', 'Upper CI', 'Regional Avg'];

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

// Relative-time formatter — turns an ISO timestamp into a short human
// phrase like "5 minutes ago" / "2 days ago" / "3 months ago". Used by
// the Model Performance card to surface the freshness of the last run.
// Returns null for invalid inputs so callers can render-guard cleanly.
function getRelativeTime(timestamp) {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return 'just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

// Inline SVG sparkline — month-over-month avg-yield trend in the Model
// Performance strip. Deliberately tiny (84×24 px) so it sits next to the
// "Avg Predicted" stat as a glanceable trend indicator without competing
// with the headline number. Renders nothing for fewer than 2 data points
// (a sparkline of 1 point is meaningless). Uses non-scaling stroke +
// rounded line caps for a soft, premium feel at small sizes.
function Sparkline({ data, color, width = 84, height = 24 }) {
  if (!Array.isArray(data) || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  // Pad y by 2px top/bottom so the line + endpoint dots don't clip at
  // the SVG bounds when a value is at the min or max of the dataset.
  const pad = 2;
  const innerHeight = height - pad * 2;
  const points = data.map((v, i) => ({
    x: i * stepX,
    y: pad + innerHeight - ((v - min) / range) * innerHeight
  }));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {/* Subtle endpoint emphasis on the most recent month — orients the
          eye toward "now" and hints at trend direction. */}
      <circle cx={last.x} cy={last.y} r={2} fill={color} />
    </svg>
  );
}

function formatNumber(value, decimals = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return numeric.toFixed(decimals);
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function formatFeatureName(value) {
  if (!value) return '—';
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

// Wheat yields that exceed this threshold are almost certainly out-of-range
// (typical yields are 30–150 bu/ac); we flag them in the table with an "Out"
// badge so reviewers can see at a glance which predictions need scrutiny.
const YIELD_OUTLIER_THRESHOLD = 200;

function isYieldOutlier(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > YIELD_OUTLIER_THRESHOLD;
}

// Returns { fg, bg, border } theme tokens for the Model column chip based on
// model family. Falls back to a neutral grey for unrecognized types.
function getModelChipPalette(modelType, theme) {
  const key = String(modelType || '').toLowerCase();
  if (key.includes('deep') || key.includes('neural') || key.includes('nn')) {
    return {
      fg: theme.palette.primary.light,
      bg: alpha(theme.palette.primary.main, 0.18),
      border: alpha(theme.palette.primary.main, 0.45)
    };
  }
  if (key.includes('catboost') || key.includes('boost') || key.includes('lgbm') || key.includes('lightgbm')) {
    return {
      fg: theme.palette.success.light,
      bg: alpha(theme.palette.success.main, 0.18),
      border: alpha(theme.palette.success.main, 0.45)
    };
  }
  if (key.includes('xgb')) {
    return {
      fg: theme.palette.warning.light,
      bg: alpha(theme.palette.warning.main, 0.18),
      border: alpha(theme.palette.warning.main, 0.45)
    };
  }
  if (key.includes('forest') || key.includes('tree')) {
    return {
      fg: theme.palette.info.light,
      bg: alpha(theme.palette.info.main, 0.18),
      border: alpha(theme.palette.info.main, 0.45)
    };
  }
  return {
    fg: theme.palette.text.secondary,
    bg: alpha(theme.palette.grey[500], 0.2),
    border: alpha(theme.palette.grey[500], 0.45)
  };
}

async function fetchPredictionRuns(signal) {
  const response = await fetch(`${API_BASE_URL}/predict/history?limit=500&page=1`, { signal });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to load prediction runs (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : [];

  return rows.map((row) => {
    const requestPayload = row.request_payload || {};
    const responsePayload = row.response_payload || {};
    const regionalComparison = row.regional_comparison || responsePayload.regional_comparison || {};
    const topFeatures = Array.isArray(row.feature_contributions)
      ? row.feature_contributions
      : Array.isArray(responsePayload?.explainability?.top_features)
        ? responsePayload.explainability.top_features
        : [];

    return {
      predictionRunId: row.prediction_run_id,
      createdAt: row.created_at,
      modelVersionTag: row.model_version_tag || '',
      modelVersionId: row.model_version_id,
      runtimeModelVersion: responsePayload.model_version || row.model_version_tag || '',
      crop: row.crop || requestPayload.crop || '',
      variety: row.variety || requestPayload.variety || '',
      season: toNumberOrNull(row.season ?? requestPayload.season),
      state: row.state || requestPayload.state || '',
      county: row.county || requestPayload.county || '',
      acres: toNumberOrNull(row.acres ?? requestPayload.acres),
      lat: toNumberOrNull(row.lat ?? requestPayload.lat),
      long: toNumberOrNull(row.long ?? requestPayload.long),
      totalN: toNumberOrNull(row.totalN_per_ac ?? requestPayload.totalN_per_ac),
      totalP: toNumberOrNull(row.totalP_per_ac ?? requestPayload.totalP_per_ac),
      totalK: toNumberOrNull(row.totalK_per_ac ?? requestPayload.totalK_per_ac),
      waterApplied: toNumberOrNull(row.water_applied_mm ?? requestPayload.water_applied_mm),
      predictedYield: toNumberOrNull(row.predicted_yield ?? responsePayload.predicted_yield),
      confidenceLower: toNumberOrNull(row.confidence_lower ?? responsePayload?.confidence_interval?.[0]),
      confidenceUpper: toNumberOrNull(row.confidence_upper ?? responsePayload?.confidence_interval?.[1]),
      regionalAvgYield: toNumberOrNull(regionalComparison?.avg_yield),
      topFeatures,
      requestPayload,
      responsePayload
    };
  });
}

async function fetchModelTypes(signal) {
  const response = await fetch(`${API_BASE_URL}/models/versions?limit=500`, { signal });
  if (!response.ok) return {};

  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : [];

  return rows.reduce((acc, row) => {
    if (row?.model_version_id !== null && row?.model_version_id !== undefined) {
      acc[row.model_version_id] = row?.model_type || '';
    }
    return acc;
  }, {});
}

// Friendly display name for the model_type strings the API returns. Mirrors
// the mapping in ModelSelectionStep so the analytics chip reads "Deep
// Learning" instead of "deep_learning_pytorch".
function getModelDisplayName(modelType) {
  const key = String(modelType || '').toLowerCase();
  if (key.includes('deep') || key.includes('pytorch') || key.includes('neural')) return 'Deep Learning';
  if (key.includes('catboost') || key.includes('lgbm') || key.includes('lightgbm') || key.includes('boost')) return 'CatBoost';
  if (key.includes('forest') || key.includes('tree')) return 'Random Forest';
  if (key.includes('xgb')) return 'XGBoost';
  return modelType || 'Unknown';
}

function MetricCard({ label, value, unit, helper, helperColor, range }) {
  const theme = useTheme();

  let rangeMarker = null;
  if (range && Number.isFinite(Number(range.min)) && Number.isFinite(Number(range.max)) && Number(range.max) > Number(range.min)) {
    const min = Number(range.min);
    const max = Number(range.max);
    const numericValue = Number.isFinite(Number(range.value)) ? Number(range.value) : null;
    const markerPct = numericValue !== null ? Math.max(0, Math.min(100, ((numericValue - min) / (max - min)) * 100)) : null;
    rangeMarker = (
      <Box sx={{ pt: 0.75 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.75 }}>
          <Typography sx={{ color: alpha(theme.palette.common.white, 0.5), fontSize: '0.78rem', fontWeight: 500 }}>
            {min.toFixed(2)}
          </Typography>
          <Typography sx={{ color: alpha(theme.palette.common.white, 0.5), fontSize: '0.78rem', fontWeight: 500 }}>
            {max.toFixed(2)}
          </Typography>
        </Stack>
        <Box
          sx={{
            position: 'relative',
            height: 4,
            borderRadius: 2,
            background: `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.22)} 0%, ${alpha(
              theme.palette.primary.main,
              0.6
            )} 100%)`,
            border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
            // Extra clearance so the marker label ("53.0") that sits at top: 12
            // doesn't visually crowd the "95% confidence interval" helper below.
            mb: 3.5
          }}
        >
          {markerPct !== null ? (
            <>
              <Box
                sx={{
                  position: 'absolute',
                  left: `${markerPct}%`,
                  top: -6,
                  transform: 'translateX(-50%)',
                  width: 2,
                  height: 16,
                  bgcolor: theme.palette.common.white,
                  borderRadius: 1,
                  boxShadow: `0 0 6px ${alpha(theme.palette.common.white, 0.55)}`
                }}
              />
              <Typography
                sx={{
                  position: 'absolute',
                  left: `${markerPct}%`,
                  top: 12,
                  transform: 'translateX(-50%)',
                  color: theme.palette.common.white,
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  whiteSpace: 'nowrap'
                }}
              >
                {numericValue.toFixed(1)}
              </Typography>
            </>
          ) : null}
        </Box>
      </Box>
    );
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        position: 'relative',
        overflow: 'hidden',
        p: 2.25,
        height: '100%',
        borderRadius: 2,
        // Same surface as the table headers + Overview metric cards so all
        // dark-card panels share one visual token.
        bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 8%, ${theme.palette.background.paper})`,
        borderColor: alpha(theme.palette.primary.main, 0.22),
        backgroundImage: 'none'
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
            sx={{ color: theme.palette.common.white, fontWeight: 700, fontSize: '1.5rem', lineHeight: 1.15 }}
          >
            {value}
          </Typography>
          {unit ? (
            <Typography
              component="span"
              sx={{ color: alpha(theme.palette.common.white, 0.55), fontWeight: 500, fontSize: '0.85rem' }}
            >
              {unit}
            </Typography>
          ) : null}
        </Stack>
        {rangeMarker}
        {helper ? (
          <Typography
            sx={{
              color: helperColor || alpha(theme.palette.common.white, 0.55),
              fontWeight: 500,
              fontSize: '0.78rem',
              lineHeight: 1.45
            }}
          >
            {helper}
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
}

// ============================================================================
// ModelPerformanceCard — macro-view summary of what the model has produced
// across the user's data. Sits at the top of the Analytics tab as a single
// compact Paper so the page reads as a clear "zoom-in":
//
//   1. Macro:  what the model has done overall  ← this card
//   2. Browse: the saved-predictions table       ← below
//   3. Micro:  the analyzed prediction view      ← appears on selection
//
// Visually subordinate to the Saved Predictions card below it (tighter
// padding, smaller numbers, single contained surface) so it informs without
// dominating the working area.
// ============================================================================
function ModelPerformanceCard({ overview, lastRunAt, avgYieldTrend, onViewRunsHistory }) {
  const theme = useTheme();
  if (!overview) return null;

  const stats = overview?.prediction_stats || {};
  const totalFieldSeasons = overview?.total_field_seasons || 0;
  const withPredictions = stats.field_seasons_with_predictions || 0;
  const coveragePct = totalFieldSeasons ? (100 * withPredictions) / totalFieldSeasons : 0;
  const fieldPredictionsTotal = stats.field_predictions_total || 0;
  const predictionRunsTotal = stats.prediction_runs_total || 0;

  // Color for the coverage bar — escalates from neutral info to warning to
  // success as coverage improves. Same thresholds the Overview's previous
  // Coverage card used so the visual story is preserved across the move.
  const coverageBarColor =
    coveragePct >= 90 ? theme.palette.success.main : coveragePct >= 75 ? theme.palette.warning.main : theme.palette.info.main;

  // The four headline stats. Held in a config array so the JSX stays
  // declarative and the layout is trivially extensible — drop in a new
  // metric here and it slots into the grid without restructuring.
  // The "Avg Predicted" entry carries `trend: true` — the strip renders a
  // small sparkline beside its number when month-over-month data exists,
  // showing the recent trajectory without needing a separate chart card.
  const stats4 = [
    { label: 'Total Predictions', value: (stats.total_predictions || 0).toLocaleString(), unit: null },
    { label: 'Avg Predicted', value: (stats.predicted_yield_avg || 0).toFixed(1), unit: 'bu/ac', trend: true },
    { label: 'Min Predicted', value: (stats.predicted_yield_min || 0).toFixed(1), unit: 'bu/ac' },
    { label: 'Max Predicted', value: (stats.predicted_yield_max || 0).toFixed(1), unit: 'bu/ac' }
  ];

  const lastRunRelative = getRelativeTime(lastRunAt);

  return (
    <Paper
      variant="outlined"
      sx={{
        // Same Deep-Learning-pill palette as the Saved Predictions card
        // and Overview metric tiles — keeps the page in one visual family.
        bgcolor: alpha(theme.palette.primary.main, 0.18),
        borderColor: alpha(theme.palette.primary.main, 0.5),
        borderRadius: 2,
        overflow: 'hidden',
        backgroundImage: 'none',
        boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.35)}`
      }}
    >
      {/* Header strip — title + run count summary on the right. Uses the
          same px/py rhythm as the Saved Predictions table card header so
          the two cards align visually when stacked. */}
      <Stack
        direction="row"
        sx={{
          px: 2.5,
          py: 1.5,
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.18)}`,
          flexWrap: 'wrap',
          gap: 1
        }}
      >
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'baseline', flexWrap: 'wrap', rowGap: 0.25 }}>
          <Typography
            sx={{
              fontWeight: 700,
              fontSize: '0.95rem',
              color: theme.palette.common.white,
              letterSpacing: '0.01em'
            }}
          >
            Model Performance
          </Typography>
          <Typography sx={{ color: alpha(theme.palette.common.white, 0.55), fontSize: '0.78rem' }}>
            Aggregate of every prediction the model has produced across your data
          </Typography>
        </Stack>
        {/* Right-side metadata cluster — total counts, last-run freshness,
            and a quiet "View runs history →" link that scrolls to the
            Saved Predictions table below. The link is rendered as a
            secondary text-button so it doesn't compete with the primary
            "Analyze Prediction" CTA. */}
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
          <Typography sx={{ color: alpha(theme.palette.primary.light, 0.85), fontSize: '0.75rem', fontWeight: 600 }}>
            {fieldPredictionsTotal.toLocaleString()} field predictions ·{' '}
            {predictionRunsTotal.toLocaleString()} runs
          </Typography>
          {lastRunRelative ? (
            <>
              <Box
                component="span"
                aria-hidden
                sx={{ color: alpha(theme.palette.common.white, 0.3), fontSize: '0.75rem' }}
              >
                ·
              </Box>
              <Tooltip
                title={lastRunAt ? `Last run: ${new Date(lastRunAt).toLocaleString()}` : ''}
                arrow
                placement="top"
              >
                <Typography
                  component="span"
                  sx={{
                    color: alpha(theme.palette.common.white, 0.65),
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    cursor: 'help'
                  }}
                >
                  Last run {lastRunRelative}
                </Typography>
              </Tooltip>
            </>
          ) : null}
          {onViewRunsHistory ? (
            <Button
              size="small"
              onClick={onViewRunsHistory}
              endIcon={<RightOutlined style={{ fontSize: '0.62rem' }} />}
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '0.75rem',
                letterSpacing: '0.01em',
                minHeight: 0,
                py: 0.15,
                px: 0.85,
                borderRadius: 999,
                color: alpha(theme.palette.primary.light, 0.95),
                bgcolor: 'transparent',
                border: `1px solid ${alpha(theme.palette.primary.main, 0.4)}`,
                transition:
                  'background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease',
                '&:hover': {
                  color: theme.palette.common.white,
                  bgcolor: alpha(theme.palette.primary.main, 0.18),
                  borderColor: theme.palette.primary.main,
                  boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.18)}`
                }
              }}
            >
              View runs history
            </Button>
          ) : null}
        </Stack>
      </Stack>

      {/* Coverage row — eyebrow label + helper on the left, the number on
          the right, thin progress bar spanning the full width below.
          Reads as a single unit: "X% covered, here's the visual." */}
      <Box sx={{ px: 2.5, pt: 1.75, pb: 1.5 }}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Stack spacing={0.25}>
            <Typography
              sx={{
                color: alpha(theme.palette.primary.light, 0.95),
                fontWeight: 700,
                fontSize: '0.7rem',
                letterSpacing: '0.12em',
                textTransform: 'uppercase'
              }}
            >
              Coverage
            </Typography>
            <Typography sx={{ color: alpha(theme.palette.common.white, 0.6), fontSize: '0.78rem' }}>
              {withPredictions.toLocaleString()} of {totalFieldSeasons.toLocaleString()} field-seasons predicted
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.6} sx={{ alignItems: 'baseline' }}>
            <Typography
              sx={{
                color: theme.palette.common.white,
                fontWeight: 700,
                fontSize: '1.4rem',
                lineHeight: 1.1,
                fontVariantNumeric: 'tabular-nums'
              }}
            >
              {coveragePct.toFixed(1)}%
            </Typography>
          </Stack>
        </Stack>
        <LinearProgress
          variant="determinate"
          value={coveragePct}
          sx={{
            height: 6,
            borderRadius: 1,
            bgcolor: alpha(theme.palette.primary.main, 0.22),
            '& .MuiLinearProgress-bar': {
              borderRadius: 1,
              bgcolor: coverageBarColor
            }
          }}
        />
      </Box>

      <Divider sx={{ borderColor: alpha(theme.palette.primary.main, 0.18) }} />

      {/* Four-stat strip — Total Predictions / Avg / Min / Max. Smaller
          values than the previous full MetricTile (1.4rem vs 1.6rem) so
          the strip feels secondary to the table's working surface below.
          Vertical dividers between stats give visual rhythm without
          adding card chrome. */}
      <Box sx={{ px: 2.5, py: 1.75 }}>
        <Grid container spacing={0}>
          {stats4.map((stat, idx) => (
            <Grid
              size={{ xs: 6, sm: 3 }}
              key={stat.label}
              sx={{
                px: { xs: 0.5, sm: 1.5 },
                borderRight: {
                  xs: 'none',
                  sm:
                    idx < stats4.length - 1
                      ? `1px solid ${alpha(theme.palette.primary.light, 0.18)}`
                      : 'none'
                }
              }}
            >
              <Stack spacing={0.4}>
                <Typography
                  sx={{
                    color: alpha(theme.palette.primary.light, 0.85),
                    fontWeight: 700,
                    fontSize: '0.65rem',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase'
                  }}
                >
                  {stat.label}
                </Typography>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.25 }}>
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'baseline' }}>
                    <Typography
                      sx={{
                        color: theme.palette.common.white,
                        fontWeight: 700,
                        fontSize: '1.4rem',
                        lineHeight: 1.1,
                        fontVariantNumeric: 'tabular-nums'
                      }}
                    >
                      {stat.value}
                    </Typography>
                    {stat.unit ? (
                      <Typography sx={{ color: alpha(theme.palette.common.white, 0.55), fontSize: '0.75rem', fontWeight: 500 }}>
                        {stat.unit}
                      </Typography>
                    ) : null}
                  </Stack>
                  {/* Trend sparkline — only on the "Avg Predicted" stat,
                      and only when we have at least 2 months of data. The
                      tooltip surfaces the underlying month-by-month
                      values so a hovering user can read the actual
                      trajectory rather than just see the curve. */}
                  {stat.trend && Array.isArray(avgYieldTrend) && avgYieldTrend.length >= 2 ? (
                    <Tooltip
                      arrow
                      placement="top"
                      title={
                        <Box sx={{ p: 0.25 }}>
                          <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, mb: 0.25 }}>
                            Avg predicted yield · last {avgYieldTrend.length} mo
                          </Typography>
                          <Typography sx={{ fontSize: '0.7rem', opacity: 0.85 }}>
                            {avgYieldTrend.map((v) => v.toFixed(1)).join(' → ')} bu/ac
                          </Typography>
                        </Box>
                      }
                    >
                      <Box sx={{ display: 'inline-flex', cursor: 'help' }}>
                        <Sparkline
                          data={avgYieldTrend}
                          color={alpha(theme.palette.primary.light, 0.9)}
                        />
                      </Box>
                    </Tooltip>
                  ) : null}
                </Stack>
              </Stack>
            </Grid>
          ))}
        </Grid>
      </Box>
    </Paper>
  );
}

export default function Analytics({ preselectedPredictionRunId = null }) {
  const theme = useTheme();
  const accentBlue = alpha(theme.palette.primary.main, 0.45);
  const headerBlue = `color-mix(in srgb, ${theme.palette.primary.main} 45%, ${theme.palette.background.paper})`;
  const rowSurface = alpha(theme.palette.grey[500], 0.12);
  // Match the table-header surface used elsewhere in the app for visual cohesion.
  const graphCardSurface = `color-mix(in srgb, ${theme.palette.primary.main} 8%, ${theme.palette.background.paper})`;
  const graphCardHeaderSurface = `color-mix(in srgb, ${theme.palette.primary.main} 12%, ${theme.palette.background.paper})`;
  const graphCardBorder = alpha(theme.palette.primary.main, 0.22);
  const chartBarSx = {
    '& .MuiBarElement-root': {
      stroke: alpha(theme.palette.grey[100], 0.45),
      strokeWidth: 1,
      filter: `drop-shadow(0 0 4px ${alpha(theme.palette.primary.main, 0.2)})`
    }
  };
  const tableScrollbarSx = {
    scrollbarWidth: 'thin',
    scrollbarColor: `${alpha(theme.palette.primary.main, 0.65)} ${alpha(theme.palette.background.default, 0.8)}`,
    '&::-webkit-scrollbar': {
      width: 10,
      height: 10
    },
    '&::-webkit-scrollbar-track': {
      background: alpha(theme.palette.background.default, 0.85),
      borderRadius: 8
    },
    '&::-webkit-scrollbar-thumb': {
      background: alpha(theme.palette.primary.main, 0.65),
      borderRadius: 8,
      border: `2px solid ${alpha(theme.palette.background.default, 0.85)}`
    },
    '&::-webkit-scrollbar-thumb:hover': {
      background: alpha(theme.palette.primary.main, 0.85)
    }
  };
  const [predictionRuns, setPredictionRuns] = useState([]);
  const [selectedPredictionRunId, setSelectedPredictionRunId] = useState(null);
  const [analyzedPrediction, setAnalyzedPrediction] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modelTypesByVersionId, setModelTypesByVersionId] = useState({});
  // Aggregate overview from /fields/overview — drives the new "Model
  // Performance" macro-view card at the top of the Analytics tab. Carries
  // `total_field_seasons` (denominator for coverage) and `prediction_stats`
  // (the totals + min/avg/max predicted yield). Failure is silent — the
  // card just won't render if the fetch errors, since it's secondary to
  // the table below.
  const [overview, setOverview] = useState(null);
  const nutrientBarColors = [theme.palette.primary.light, theme.palette.primary.main, theme.palette.primary.dark];
  const yieldBarColors = [theme.palette.warning.main, theme.palette.error.main, theme.palette.info.main, theme.palette.secondary.main];

  useEffect(() => {
    const controller = new AbortController();

    const loadPredictionRuns = async () => {
      setIsLoading(true);
      setLoadError('');
      try {
        const [rows, modelTypes] = await Promise.all([
          fetchPredictionRuns(controller.signal),
          fetchModelTypes(controller.signal).catch(() => ({}))
        ]);
        setPredictionRuns(rows);
        setModelTypesByVersionId(modelTypes);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setLoadError(error.message || 'Failed to load saved predictions.');
          setPredictionRuns([]);
          setModelTypesByVersionId({});
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadPredictionRuns();

    return () => controller.abort();
  }, []);

  // Pull the aggregate overview that powers the Model Performance card at
  // the top of the tab. Same endpoint the Overview tab uses; we just need
  // total_field_seasons + prediction_stats.
  useEffect(() => {
    const controller = new AbortController();
    const loadOverview = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/fields/overview`, { signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json();
        setOverview(payload);
      } catch (error) {
        if (error.name !== 'AbortError') {
          // Silent — Model Performance card just won't render. The table
          // below it is the primary working surface either way.
        }
      }
    };
    loadOverview();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!preselectedPredictionRunId) return;
    const matched = predictionRuns.find((row) => String(row.predictionRunId) === String(preselectedPredictionRunId));
    if (matched) {
      setSelectedPredictionRunId(matched.predictionRunId);
    }
  }, [preselectedPredictionRunId, predictionRuns]);

  const selectedPrediction = useMemo(
    () => predictionRuns.find((row) => row.predictionRunId === selectedPredictionRunId) || null,
    [predictionRuns, selectedPredictionRunId]
  );

  const nutrientSeries = useMemo(() => {
    if (!analyzedPrediction) return [];
    return [analyzedPrediction.totalN ?? 0, analyzedPrediction.totalP ?? 0, analyzedPrediction.totalK ?? 0];
  }, [analyzedPrediction]);

  const yieldContextSeries = useMemo(() => {
    if (!analyzedPrediction) return [];
    return [
      analyzedPrediction.confidenceLower ?? 0,
      analyzedPrediction.predictedYield ?? 0,
      analyzedPrediction.confidenceUpper ?? 0,
      analyzedPrediction.regionalAvgYield ?? 0
    ];
  }, [analyzedPrediction]);

  const handleAnalyzePrediction = () => {
    if (!selectedPrediction) return;
    setAnalyzedPrediction(selectedPrediction);
  };

  // Sub-navigation: the Analytics tab is split into two task-shaped views
  // selected via a ToggleButtonGroup at the top.
  //   'predictions' — Saved Predictions table + analyzed-prediction drawer
  //                   (the action-oriented working surface)
  //   'model-data'  — Model Performance card + Field Records table
  //                   (the reference-oriented context surface)
  // Default to 'predictions' since that's the primary work users come here
  // for; the Model & Data view is consulted occasionally.
  const [analyticsView, setAnalyticsView] = useState('predictions');

  const handleViewChange = (_, newView) => {
    if (!newView) return; // ToggleButtonGroup fires null when active is re-clicked; ignore.
    setAnalyticsView(newView);
    // Switching away from Predictions auto-closes the analysis drawer so
    // it doesn't linger over a view it doesn't belong on.
    if (newView !== 'predictions') {
      setAnalyzedPrediction(null);
    }
  };

  // "View runs history" — clicked from the Model Performance card on the
  // Model & Data view. Switches to the Predictions view first (where the
  // Saved Predictions table actually lives) and then scrolls to it. The
  // setTimeout defers the scroll until React has had a chance to render
  // the Predictions view; without that, getElementById finds nothing
  // because the table isn't mounted yet.
  const handleViewRunsHistory = () => {
    setAnalyticsView('predictions');
    setTimeout(() => {
      const el = document.getElementById('saved-predictions-table');
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 60);
  };

  // Derive last-run timestamp + month-over-month avg-yield trend from the
  // already-fetched predictionRuns. Both feed the Model Performance card:
  // `lastRunAt` becomes the "Last run · 2 days ago" stamp in the header,
  // `avgYieldTrend` becomes the sparkline beside the Avg Predicted stat.
  // We cap the trend at the last 6 months so the sparkline stays readable
  // at its tiny 84×24 footprint.
  const predictionTimeline = useMemo(() => {
    if (!Array.isArray(predictionRuns) || predictionRuns.length === 0) return null;
    const valid = predictionRuns.filter(
      (r) => r?.createdAt && Number.isFinite(Number(r?.predictedYield))
    );
    if (valid.length === 0) return null;
    const sorted = [...valid].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const lastRunAt = sorted[sorted.length - 1].createdAt;

    // Group by year-month, average predicted yield per month.
    const byMonth = new Map();
    for (const run of sorted) {
      const d = new Date(run.createdAt);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`;
      const entry = byMonth.get(key) || { sum: 0, count: 0 };
      entry.sum += Number(run.predictedYield);
      entry.count += 1;
      byMonth.set(key, entry);
    }
    // Map iteration order is insertion order; since we sorted by date
    // first, the months come out chronologically without re-sorting.
    const monthlyAvgs = Array.from(byMonth.values()).map((e) => e.sum / e.count);
    const trend = monthlyAvgs.slice(-6);
    return { lastRunAt, avgYieldTrend: trend };
  }, [predictionRuns]);

  return (
    <MainCard title="Prediction Analytics">
      <Stack spacing={2.5}>
        {/* Sub-navigation: pill-style segmented control splitting this tab
            into the action-oriented Predictions view and the
            reference-oriented Model & Data view. Wider rectangle than the
            other pills on the page (no whitespace-nowrap) so the labels
            read clearly; primary-blue tonal family matches the rest of
            the Crop Studio surfaces. */}
        <Box>
          <ToggleButtonGroup
            value={analyticsView}
            exclusive
            onChange={handleViewChange}
            aria-label="Analytics view"
            sx={{
              borderRadius: 999,
              p: 0.4,
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              border: `1px solid ${alpha(theme.palette.primary.main, 0.32)}`,
              gap: 0.5,
              // Stretch and re-style each ToggleButton so they sit as
              // soft pills inside the outer rounded container.
              '& .MuiToggleButton-root': {
                border: 'none',
                borderRadius: 999,
                px: 2.25,
                py: 0.5,
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '0.82rem',
                letterSpacing: '0.01em',
                color: alpha(theme.palette.common.white, 0.7),
                transition: 'background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease',
                '&:hover': {
                  color: theme.palette.common.white,
                  bgcolor: alpha(theme.palette.primary.main, 0.18)
                },
                '&.Mui-selected': {
                  bgcolor: alpha(theme.palette.primary.main, 0.4),
                  color: theme.palette.common.white,
                  boxShadow: `0 1px 0 ${alpha(theme.palette.primary.main, 0.55)}`,
                  '&:hover': {
                    bgcolor: alpha(theme.palette.primary.main, 0.48)
                  }
                }
              }
            }}
          >
            <ToggleButton value="predictions">Predictions</ToggleButton>
            <ToggleButton value="model-data">Model &amp; Data</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {/* ===================== VIEW A — PREDICTIONS ===================== */}
        {analyticsView === 'predictions' ? (
          <>
            {/* Brief context line above the table — clarifies the user's path
                through the page (browse the table → select → analyze). */}
            <Typography variant="body1" color="text.primary">
              Select a saved prediction from the table below, then run analysis using the exact values used for that prediction.
            </Typography>

            {loadError ? <Alert severity="error">{loadError}</Alert> : null}

        <Paper
          id="saved-predictions-table"
          variant="outlined"
          sx={{
            // Match the Deep-Learning-pill / metric-tile palette so the
            // Saved Predictions card reads as part of the same "primary"
            // family of surfaces as the Overview cards and the Field
            // Performance Records table card.
            bgcolor: alpha(theme.palette.primary.main, 0.18),
            borderColor: alpha(theme.palette.primary.main, 0.5),
            borderRadius: 2,
            overflow: 'hidden',
            // `scrollMarginTop` gives the smooth-scroll from "View runs
            // history" some breathing room so the card's header isn't
            // jammed against the top of the viewport when the link lands.
            scrollMarginTop: 24,
            boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.35)}`
          }}
        >
          <Stack
            direction="row"
            sx={{
              px: 2.5,
              py: 1.75,
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.18)}`
            }}
          >
            <Typography variant="subtitle1" sx={{ fontWeight: 700, color: theme.palette.text.primary, letterSpacing: '0.01em' }}>
              Saved Predictions
            </Typography>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
              <Typography variant="body2" sx={{ color: alpha(theme.palette.primary.light, 0.85), fontWeight: 500 }}>
                {predictionRuns.length} prediction{predictionRuns.length === 1 ? '' : 's'}
              </Typography>
              {/* Visual-only icon button — no download handler wired up yet. */}
              <Tooltip
                title="Download"
                arrow
                placement="top"
                slotProps={{
                  tooltip: {
                    sx: {
                      // Match the table-header / metric-card surface for visual cohesion.
                      bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 14%, ${theme.palette.background.paper})`,
                      color: theme.palette.common.white,
                      border: `1px solid ${alpha(theme.palette.primary.main, 0.45)}`,
                      borderRadius: 1,
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      letterSpacing: '0.02em',
                      px: 1.25,
                      py: 0.65,
                      boxShadow: `0 6px 18px ${alpha(theme.palette.common.black, 0.45)}`
                    }
                  },
                  arrow: {
                    sx: {
                      color: `color-mix(in srgb, ${theme.palette.primary.main} 14%, ${theme.palette.background.paper})`,
                      '&::before': {
                        border: `1px solid ${alpha(theme.palette.primary.main, 0.45)}`
                      }
                    }
                  }
                }}
              >
                <IconButton
                  size="small"
                  aria-label="Download saved predictions"
                  sx={{
                    color: alpha(theme.palette.primary.light, 0.9),
                    bgcolor: alpha(theme.palette.primary.main, 0.1),
                    border: `1px solid ${alpha(theme.palette.primary.main, 0.35)}`,
                    borderRadius: 1.5,
                    p: 0.75,
                    transition: 'background 0.2s ease, border-color 0.2s ease, color 0.2s ease',
                    '&:hover': {
                      bgcolor: alpha(theme.palette.primary.main, 0.2),
                      borderColor: theme.palette.primary.main,
                      color: theme.palette.primary.light
                    }
                  }}
                >
                  <DownloadOutlined style={{ fontSize: '0.95rem' }} />
                </IconButton>
              </Tooltip>
            </Stack>
          </Stack>

          {isLoading ? <LinearProgress /> : null}

          <TableContainer
            sx={{
              maxHeight: 360,
              ...tableScrollbarSx
            }}
          >
            <Table
              stickyHeader
              size="small"
              sx={{
                minWidth: 1700,
                '& .MuiTableCell-root': { textAlign: 'center !important' }
              }}
            >
              <TableHead>
                <TableRow
                  sx={{
                    '& .MuiTableCell-root': {
                      // Equivalent to alpha(primary.main, 0.08) but fully opaque, so
                      // rows can't bleed through the sticky header while scrolling.
                      bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 8%, ${theme.palette.background.paper})`,
                      borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.22)}`,
                      color: alpha(theme.palette.primary.light, 0.85),
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                      py: 1.25
                    }
                  }}
                >
                  <TableCell sx={{ width: 56 }}>Select</TableCell>
                  <TableCell align="right" sx={{ width: 90, px: 1 }}>
                    Pred #
                  </TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Model</TableCell>
                  <TableCell>Crop</TableCell>
                  <TableCell>Variety</TableCell>
                  <TableCell>Season</TableCell>
                  <TableCell>State</TableCell>
                  <TableCell>County</TableCell>
                  <TableCell align="right">Predicted Yield</TableCell>
                  <TableCell align="right">Acres</TableCell>
                  <TableCell align="right">N</TableCell>
                  <TableCell align="right">P</TableCell>
                  <TableCell align="right">K</TableCell>
                  <TableCell align="right">Water (mm)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {!isLoading && predictionRuns.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={15}>
                      <Stack spacing={0.5} sx={{ py: 1 }}>
                        <Typography variant="body2">No saved predictions found.</Typography>
                        <Typography variant="caption" color="text.secondary">
                          Run a prediction from the Predict tab to get started.
                        </Typography>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ) : null}

                {predictionRuns.map((row) => {
                  const isSelected = row.predictionRunId === selectedPredictionRunId;
                  const modelType = modelTypesByVersionId[row.modelVersionId] || row.modelVersionTag || '';
                  const modelChip = modelType ? getModelChipPalette(modelType, theme) : null;
                  const yieldOutlier = isYieldOutlier(row.predictedYield);
                  const yieldColor = yieldOutlier ? theme.palette.error.main : theme.palette.success.main;
                  const mutedAccent = alpha(theme.palette.primary.light, 0.85);
                  return (
                    <TableRow
                      key={row.predictionRunId}
                      hover
                      selected={isSelected}
                      onClick={() => setSelectedPredictionRunId(row.predictionRunId)}
                      sx={{
                        cursor: 'pointer',
                        '& .MuiTableCell-root': {
                          borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.08)}`
                        },
                        '&:hover': {
                          bgcolor: alpha(theme.palette.primary.main, 0.08)
                        },
                        '&.Mui-selected, &.Mui-selected:hover': {
                          bgcolor: alpha(theme.palette.primary.main, 0.14)
                        }
                      }}
                    >
                      <TableCell padding="checkbox">
                        <Radio
                          size="small"
                          checked={isSelected}
                          onChange={() => setSelectedPredictionRunId(row.predictionRunId)}
                        />
                      </TableCell>
                      <TableCell align="right" sx={{ width: 90, px: 1, color: mutedAccent }}>
                        {row.predictionRunId ?? '—'}
                      </TableCell>
                      <TableCell sx={{ color: theme.palette.text.secondary }}>{formatDateTime(row.createdAt)}</TableCell>
                      <TableCell>
                        {modelType && modelChip ? (
                          <Chip
                            size="small"
                            label={modelType}
                            sx={{
                              fontWeight: 600,
                              fontSize: '0.72rem',
                              color: modelChip.fg,
                              bgcolor: modelChip.bg,
                              border: `1px solid ${modelChip.border}`,
                              borderRadius: 999,
                              height: 22
                            }}
                          />
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>{row.crop ? formatCropName(row.crop) : '—'}</TableCell>
                      <TableCell>{row.variety || '—'}</TableCell>
                      <TableCell sx={{ color: mutedAccent }}>{row.season ?? '—'}</TableCell>
                      <TableCell>{row.state || '—'}</TableCell>
                      <TableCell sx={{ color: mutedAccent }}>{row.county || '—'}</TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', justifyContent: 'center' }}>
                          <Typography component="span" sx={{ color: yieldColor, fontWeight: 700, fontSize: '0.9rem' }}>
                            {formatNumber(row.predictedYield)}
                          </Typography>
                          <Typography component="span" sx={{ color: theme.palette.text.secondary, fontSize: '0.78rem' }}>
                            bu/ac
                          </Typography>
                          {yieldOutlier ? (
                            <Chip
                              size="small"
                              label="Out"
                              sx={{
                                height: 18,
                                fontSize: '0.62rem',
                                fontWeight: 700,
                                color: theme.palette.error.light,
                                bgcolor: alpha(theme.palette.error.main, 0.18),
                                border: `1px solid ${alpha(theme.palette.error.main, 0.5)}`,
                                borderRadius: 999,
                                '& .MuiChip-label': { px: 0.75 }
                              }}
                            />
                          ) : null}
                        </Stack>
                      </TableCell>
                      <TableCell align="right">{formatNumber(row.acres)}</TableCell>
                      <TableCell align="right">{formatNumber(row.totalN)}</TableCell>
                      <TableCell align="right">{formatNumber(row.totalP)}</TableCell>
                      <TableCell align="right">{formatNumber(row.totalK)}</TableCell>
                      <TableCell align="right">{formatNumber(row.waterApplied)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          <Stack
            direction="row"
            sx={{
              px: 2.5,
              py: 1.75,
              alignItems: 'center',
              justifyContent: 'space-between',
              borderTop: `1px solid ${alpha(theme.palette.primary.main, 0.18)}`
            }}
          >
            <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
              {selectedPrediction ? `Prediction #${selectedPrediction.predictionRunId} selected` : 'No prediction selected'}
            </Typography>
            <Button
              variant="contained"
              disabled={!selectedPrediction || isLoading}
              onClick={handleAnalyzePrediction}
              endIcon={
                <Box component="span" aria-hidden sx={{ fontSize: '1.1rem', lineHeight: 1 }}>
                  →
                </Box>
              }
              sx={{
                fontWeight: 600,
                '&.Mui-disabled': {
                  backgroundColor: alpha(theme.palette.primary.main, 0.32),
                  color: alpha(theme.palette.text.primary, 0.6)
                }
              }}
            >
              Analyze Prediction
            </Button>
          </Stack>
        </Paper>

        {!analyzedPrediction ? (
          <Alert
            severity="success"
            variant="outlined"
            sx={{
              backgroundColor: alpha(theme.palette.success.light, 0.12),
              borderColor: alpha(theme.palette.success.main, 0.28),
              color: theme.palette.success.main,
              '& .MuiAlert-icon': {
                color: alpha(theme.palette.success.main, 0.85)
              },
              '& .MuiAlert-message strong': {
                color: theme.palette.primary.main
              }
            }}
          >
            Select one prediction from the table above and click <strong>Analyze Prediction</strong> to view analytics for the selected
            prediction.
          </Alert>
        ) : (
          // Analyzed view now lives in a right-anchored Drawer instead of
          // expanding inline below the table. Two reasons: (1) the
          // analysis content has grown — chip row + 4 metric cards + 2
          // chart cards + Top Features + Inputs Applied — and pushing the
          // table off-screen each time a prediction was analyzed broke the
          // user's "browse → drill in → back to browse" rhythm; (2) the
          // Drawer keeps the macro+browse layers visible behind the
          // micro view, so the page reads as a layered focus rather than
          // one long scroll. The Drawer's `open` is bound to the truthy
          // analyzedPrediction; closing the Drawer just clears the state.
          <Drawer
            anchor="right"
            open
            onClose={() => setAnalyzedPrediction(null)}
            PaperProps={{
              sx: {
                width: { xs: '100%', md: 720, lg: 820 },
                bgcolor: theme.palette.background.paper,
                borderLeft: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
                backgroundImage: 'none',
                display: 'flex',
                flexDirection: 'column'
              }
            }}
          >
            {/* Drawer header — eyebrow + "Prediction #N" title on the
                left, X close button on the right. Sticky-feeling because
                the body below it scrolls. */}
            <Stack
              direction="row"
              sx={{
                px: 3,
                py: 2,
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.28)}`,
                bgcolor: alpha(theme.palette.primary.main, 0.12),
                flexShrink: 0
              }}
            >
              <Stack spacing={0.25}>
                <Typography
                  sx={{
                    color: alpha(theme.palette.primary.light, 0.85),
                    fontWeight: 700,
                    fontSize: '0.7rem',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase'
                  }}
                >
                  Prediction Analysis
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 700, color: theme.palette.common.white }}>
                  Prediction #{analyzedPrediction.predictionRunId}
                </Typography>
              </Stack>
              <IconButton
                onClick={() => setAnalyzedPrediction(null)}
                sx={{
                  color: alpha(theme.palette.common.white, 0.7),
                  '&:hover': {
                    color: theme.palette.common.white,
                    bgcolor: alpha(theme.palette.primary.main, 0.18)
                  }
                }}
                aria-label="Close prediction analysis"
              >
                <CloseOutlined />
              </IconButton>
            </Stack>

            {/* Scrollable body — `flex: 1` lets it consume remaining
                drawer height; `overflowY: auto` confines the scroll so
                the header stays pinned while the analysis content
                scrolls underneath. */}
            <Box sx={{ p: 3, overflowY: 'auto', flex: 1 }}>
          <Stack spacing={2.5}>
            {(() => {
              // Resolve the friendly model name from the looked-up model_type, falling
              // back to whatever the response payload or version tag carries.
              const modelTypeRaw =
                modelTypesByVersionId[analyzedPrediction.modelVersionId] ||
                analyzedPrediction.responsePayload?.model_type ||
                analyzedPrediction.modelVersionTag ||
                '';
              const modelDisplay = getModelDisplayName(modelTypeRaw);
              const outlinedChipSx = {
                bgcolor: 'transparent',
                color: alpha(theme.palette.common.white, 0.85),
                border: `1px solid ${alpha(theme.palette.primary.main, 0.4)}`,
                borderRadius: 999,
                fontWeight: 500,
                '& .MuiChip-label': { px: 1.5 }
              };
              return (
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                  <Chip
                    label={`Prediction #${analyzedPrediction.predictionRunId}`}
                    sx={{
                      bgcolor: theme.palette.primary.main,
                      color: theme.palette.common.white,
                      fontWeight: 700,
                      borderRadius: 999,
                      '& .MuiChip-label': { px: 1.75 }
                    }}
                  />
                  <Chip label={`Model: ${modelDisplay}`} sx={outlinedChipSx} />
                  <Chip label={`Crop: ${analyzedPrediction.crop ? formatCropName(analyzedPrediction.crop) : 'Unknown'}`} sx={outlinedChipSx} />
                  <Chip label={`Season: ${analyzedPrediction.season ?? 'Unknown'}`} sx={outlinedChipSx} />
                </Stack>
              );
            })()}

            {(() => {
              const lower = analyzedPrediction.confidenceLower;
              const upper = analyzedPrediction.confidenceUpper;
              const predicted = analyzedPrediction.predictedYield;
              const regional = analyzedPrediction.regionalAvgYield;
              const hasInterval = Number.isFinite(lower) && Number.isFinite(upper) && upper > lower;
              const hasRegional = Number.isFinite(regional) && regional > 0 && Number.isFinite(predicted);

              let regionalHelper = null;
              let regionalHelperColor = null;
              if (hasRegional) {
                const pct = ((predicted - regional) / regional) * 100;
                const sign = pct >= 0 ? '+' : '';
                const direction = pct >= 0 ? 'above' : 'below';
                regionalHelper = `${sign}${Math.round(pct)}% ${direction} regional avg`;
                regionalHelperColor = pct >= 0 ? theme.palette.success.main : theme.palette.error.main;
              }

              const locationParts = [];
              if (analyzedPrediction.state) locationParts.push(analyzedPrediction.state);
              if (analyzedPrediction.county) locationParts.push(analyzedPrediction.county);
              if (analyzedPrediction.season != null && analyzedPrediction.season !== '') {
                locationParts.push(String(analyzedPrediction.season));
              }

              return (
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, md: 3 }}>
                    <MetricCard
                      label="Predicted Yield"
                      value={formatNumber(predicted)}
                      unit="bu/ac"
                      helper="95% confidence interval (bu/ac)"
                      range={hasInterval ? { min: lower, max: upper, value: predicted } : null}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, md: 3 }}>
                    <MetricCard
                      label="Confidence Width"
                      value={hasInterval ? formatNumber(upper - lower) : '—'}
                      unit={hasInterval ? 'bu/ac' : null}
                      helper={hasInterval ? `Range: ${formatNumber(lower)} — ${formatNumber(upper)}` : null}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, md: 3 }}>
                    <MetricCard
                      label="Regional Average"
                      value={hasRegional ? formatNumber(regional) : '—'}
                      unit={hasRegional ? 'bu/ac' : null}
                      helper={regionalHelper}
                      helperColor={regionalHelperColor}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, md: 3 }}>
                    <MetricCard
                      label="Created At"
                      value={formatDateTime(analyzedPrediction.createdAt)}
                      helper={locationParts.length > 0 ? locationParts.join(' • ') : null}
                    />
                  </Grid>
                </Grid>
              );
            })()}

            {(() => {
              const totalN = analyzedPrediction.totalN;
              const totalP = analyzedPrediction.totalP;
              const totalK = analyzedPrediction.totalK;
              const hasNutrients =
                (Number.isFinite(totalN) && totalN > 0) ||
                (Number.isFinite(totalP) && totalP > 0) ||
                (Number.isFinite(totalK) && totalK > 0);

              // Fixed inner content height for both chart cards — accommodates the
              // BarChart's 280px SVG plus any legend/axis padding so the chart and
              // the empty state always render at the same total height.
              const chartContentHeight = 320;
              const chartCardSx = {
                bgcolor: graphCardSurface,
                border: `1px solid ${graphCardBorder}`,
                borderRadius: 2,
                backgroundImage: 'none',
                // Stretch the card to fill its Grid item so siblings equalize
                // even if one card's intrinsic content is taller than the other.
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                '& .MuiCardHeader-root': {
                  bgcolor: 'transparent',
                  borderBottom: `1px solid ${graphCardBorder}`,
                  px: 2.5,
                  py: 1.75
                },
                '& .MuiCardHeader-title': {
                  color: theme.palette.common.white,
                  fontWeight: 700,
                  letterSpacing: '0.01em',
                  fontSize: '1rem'
                }
              };

              return (
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, lg: 6 }}>
                    <MainCard title="Yield Context" content={false} sx={chartCardSx}>
                      <Box sx={{ p: 2, height: chartContentHeight, boxSizing: 'border-box' }}>
                        <BarChart
                          height={280}
                          sx={chartBarSx}
                          xAxis={[
                            {
                              scaleType: 'band',
                              data: YIELD_CATEGORIES,
                              colorMap: { type: 'ordinal', values: YIELD_CATEGORIES, colors: yieldBarColors }
                            }
                          ]}
                          series={[{ data: yieldContextSeries, label: 'Yield (bu/ac)' }]}
                        />
                      </Box>
                    </MainCard>
                  </Grid>
                  <Grid size={{ xs: 12, lg: 6 }}>
                    <MainCard title="Nutrient Inputs" content={false} sx={chartCardSx}>
                      {hasNutrients ? (
                        <Box sx={{ p: 2, height: chartContentHeight, boxSizing: 'border-box' }}>
                          <BarChart
                            height={280}
                            sx={chartBarSx}
                            xAxis={[
                              {
                                scaleType: 'band',
                                data: NUTRIENT_CATEGORIES,
                                colorMap: { type: 'ordinal', values: NUTRIENT_CATEGORIES, colors: nutrientBarColors }
                              }
                            ]}
                            series={[{ data: nutrientSeries, label: 'Input Amount' }]}
                          />
                        </Box>
                      ) : (
                        // Same outer Box dimensions as the chart branch so the
                        // empty state matches the BarChart's effective height.
                        // The inner Stack now fills the Box (height: 100%)
                        // instead of having its own fixed 280px height.
                        <Box sx={{ p: 2, height: chartContentHeight, boxSizing: 'border-box' }}>
                          <Stack
                            spacing={1.5}
                            sx={{
                              height: '100%',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            <Box
                              sx={{
                                color: alpha(theme.palette.primary.light, 0.5),
                                fontSize: '2.4rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                              }}
                            >
                              <AppstoreOutlined />
                            </Box>
                            <Typography
                              sx={{
                                color: alpha(theme.palette.common.white, 0.55),
                                textAlign: 'center',
                                fontSize: '0.9rem',
                                lineHeight: 1.5,
                                maxWidth: 240
                              }}
                            >
                              No nutrient inputs recorded for this prediction
                            </Typography>
                          </Stack>
                        </Box>
                      )}
                    </MainCard>
                  </Grid>
                </Grid>
              );
            })()}

            <Paper
              variant="outlined"
              sx={{
                p: 2,
                bgcolor: graphCardSurface,
                borderColor: graphCardBorder
              }}
            >
              <Stack spacing={1.25}>
                <Typography
                  variant="subtitle2"
                  sx={{
                    color: alpha(theme.palette.primary.light, 0.92),
                    fontWeight: 600,
                    letterSpacing: '0.02em',
                    textTransform: 'uppercase',
                    textShadow: `0 0 10px ${alpha(theme.palette.primary.main, 0.28)}`
                  }}
                >
                  Top Features
                </Typography>
                <TableContainer sx={{ border: 1, borderColor: accentBlue, borderRadius: 1, ...tableScrollbarSx }}>
                  <Table size="small" sx={{ minWidth: 860 }}>
                    <TableHead>
                      <TableRow
                        sx={{
                          '& .MuiTableCell-root': {
                            bgcolor: headerBlue,
                            borderBottomColor: accentBlue,
                            borderBottomWidth: 2,
                            color: theme.palette.text.primary,
                            whiteSpace: 'nowrap'
                          }
                        }}
                      >
                        <TableCell>Feature</TableCell>
                        <TableCell>Value</TableCell>
                        <TableCell>Direction</TableCell>
                        <TableCell align="right">Importance</TableCell>
                        <TableCell>Contribution</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {analyzedPrediction.topFeatures.length > 0 ? (
                        analyzedPrediction.topFeatures.map((feature, index) => {
                          const importance = Math.max(toNumberOrNull(feature?.importance) || 0, 0);
                          const barPct = Math.min(importance * 100, 100);
                          const direction = String(feature?.direction || '').toLowerCase();
                          const directionColor = direction === 'positive' ? 'success' : direction === 'negative' ? 'error' : 'default';
                          return (
                            <TableRow key={`${feature.feature}-${index}`} hover sx={{ bgcolor: rowSurface }}>
                              <TableCell>{formatFeatureName(feature?.feature)}</TableCell>
                              <TableCell>{String(feature?.value ?? '—')}</TableCell>
                              <TableCell>
                                <Chip size="small" color={directionColor} label={direction || 'unknown'} variant="outlined" />
                              </TableCell>
                              <TableCell align="right">{formatNumber(importance * 100, 2)}%</TableCell>
                              <TableCell sx={{ minWidth: 180 }}>
                                <Box
                                  sx={{ height: 8, borderRadius: 1, bgcolor: alpha(theme.palette.primary.main, 0.18), overflow: 'hidden' }}
                                >
                                  <Box sx={{ width: `${barPct}%`, height: '100%', bgcolor: theme.palette.primary.main }} />
                                </Box>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      ) : (
                        <TableRow sx={{ bgcolor: rowSurface }}>
                          <TableCell colSpan={5}>
                            <Typography variant="body2" sx={{ color: alpha(theme.palette.grey[300], 0.92), fontWeight: 500 }}>
                              Explainability data was not returned for this prediction.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Stack>
            </Paper>

            <Paper
              variant="outlined"
              sx={{
                p: 2,
                bgcolor: graphCardSurface,
                borderColor: graphCardBorder
              }}
            >
              <Stack spacing={1.25}>
                <Typography
                  variant="subtitle2"
                  sx={{
                    color: alpha(theme.palette.primary.light, 0.92),
                    fontWeight: 600,
                    letterSpacing: '0.02em',
                    textTransform: 'uppercase',
                    textShadow: `0 0 10px ${alpha(theme.palette.primary.main, 0.28)}`
                  }}
                >
                  Inputs Applied To Model
                </Typography>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <MetricCard label="Crop" value={analyzedPrediction.crop ? formatCropName(analyzedPrediction.crop) : '—'} />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <MetricCard label="Variety" value={analyzedPrediction.variety || '—'} />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <MetricCard label="Season" value={analyzedPrediction.season ?? '—'} />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <MetricCard label="Acres" value={formatNumber(analyzedPrediction.acres)} />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <MetricCard label="N (lb/ac)" value={formatNumber(analyzedPrediction.totalN)} />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <MetricCard label="P (lb/ac)" value={formatNumber(analyzedPrediction.totalP)} />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <MetricCard label="K (lb/ac)" value={formatNumber(analyzedPrediction.totalK)} />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <MetricCard label="Water Applied (mm)" value={formatNumber(analyzedPrediction.waterApplied)} />
                  </Grid>
                  {/* <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <MetricCard label="Latitude" value={formatNumber(analyzedPrediction.lat, 6)} />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <MetricCard label="Longitude" value={formatNumber(analyzedPrediction.long, 6)} />
                  </Grid> */}
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <MetricCard label="State" value={analyzedPrediction.state || '—'} />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <MetricCard label="County" value={analyzedPrediction.county || '—'} />
                  </Grid>
                </Grid>
              </Stack>
            </Paper>
          </Stack>
            </Box>
          </Drawer>
        )}
          </>
        ) : (
          /* ===================== VIEW B — MODEL & DATA =====================
             Model Performance macro card on top (the model's track record),
             followed by the Field Performance Records table (with its
             "Why is predicting yields important?" banner inside). This is
             the reference view — context the user reads occasionally
             rather than acts on every visit. */
          <>
            <ModelPerformanceCard
              overview={overview}
              lastRunAt={predictionTimeline?.lastRunAt}
              avgYieldTrend={predictionTimeline?.avgYieldTrend}
              onViewRunsHistory={handleViewRunsHistory}
            />

            {/* Field-level records table — chevron + row-click affordance
                hidden because Analytics is read-only context; the Overview
                tab keeps a chevron-enabled copy for drilling into field
                detail. The "Why predict yields on harvests?" explainer
                banner is rendered inside FieldTable, so it lands here
                automatically. */}
            <FieldTable showChevron={false} />
          </>
        )}
      </Stack>
    </MainCard>
  );
}
