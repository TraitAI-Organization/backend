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
import FallOutlined from '@ant-design/icons/FallOutlined';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';
import RiseOutlined from '@ant-design/icons/RiseOutlined';
import ThunderboltOutlined from '@ant-design/icons/ThunderboltOutlined';

import MainCard from 'components/MainCard';
import FieldTable from 'sections/intelligence/crop-studio/FieldTable';
import ModelRegressionCard from 'sections/intelligence/crop-studio/ModelRegressionCard';
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

// CSV escaping per RFC 4180: quote any cell that contains a comma, quote, or
// newline; double internal quotes. Null/undefined become empty strings so the
// column is still present (preserving column alignment across rows).
function csvCell(value) {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Trigger a client-side CSV download. Encodes UTF-8 with a BOM so Excel on
// Windows opens it correctly (without the BOM Excel guesses Windows-1252 and
// mangles characters like ° and °C). Cleans up the blob URL after click.
function downloadCsv(rows, filename) {
  const csv = rows.map((cells) => cells.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Defer revoke so Safari has time to start the download before the URL
  // becomes invalid. 0ms is enough in practice; we use 1s for safety.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Build a one-row-per-prediction CSV that mirrors what the user sees in the
// Saved Predictions table PLUS the analysis-drawer values that aren't in the
// table (confidence interval, regional baseline + source, top SHAP features).
// `stateStats` provides the state-level regional-avg fallback the drawer uses
// when the prediction's own county-level regional_comparison was empty.
function buildPredictionRunsCsv(rows, modelTypesByVersionId, stateStats) {
  const header = [
    'Prediction Run ID',
    'Created At',
    'Model Type',
    'Model Version Tag',
    'Runtime Model Version',
    'Crop',
    'Variety',
    'Season',
    'State',
    'County',
    'Acres',
    'N (lb/ac)',
    'P (lb/ac)',
    'K (lb/ac)',
    'Water Applied (mm)',
    'Predicted Yield (bu/ac)',
    'Confidence Lower (bu/ac)',
    'Confidence Upper (bu/ac)',
    'Confidence Width (bu/ac)',
    'Confidence Level (%)',
    'Regional Avg Yield (bu/ac)',
    'Regional Avg Source',
    'Regional Delta vs Predicted (%)',
    'Top Feature 1',
    'Top Feature 2',
    'Top Feature 3',
    'Top Feature 4',
    'Top Feature 5'
  ];

  const formatTopFeature = (feat) => {
    if (!feat) return '';
    const name = formatFeatureName(feat.feature);
    const value = feat.value === null || feat.value === undefined ? '—' : String(feat.value);
    const direction = String(feat.direction || '').toLowerCase() || 'unknown';
    const importance = Math.max(Number(feat.importance) || 0, 0) * 100;
    return `${name} (value=${value}, direction=${direction}, impact=${importance.toFixed(2)}%)`;
  };

  const body = rows.map((row) => {
    const lower = row.confidenceLower;
    const upper = row.confidenceUpper;
    const predicted = row.predictedYield;
    const width = Number.isFinite(lower) && Number.isFinite(upper) ? upper - lower : null;

    // Match the drawer's fallback logic: prefer the prediction's own
    // county-level regional_comparison, fall back to the state-level
    // aggregate so the CSV reflects what the user saw on screen.
    let regional = row.regionalAvgYield;
    let regionalSource = Number.isFinite(regional) && regional > 0 ? 'county' : '';
    if (!regionalSource) {
      const stateRow = row.state ? stateStats[row.state] : null;
      const stateAvg = stateRow != null ? Number(stateRow.avg_yield) : null;
      if (Number.isFinite(stateAvg) && stateAvg > 0) {
        regional = stateAvg;
        regionalSource = 'state';
      }
    }
    const regionalDelta =
      Number.isFinite(regional) && regional > 0 && Number.isFinite(predicted) ? ((predicted - regional) / regional) * 100 : null;

    const modelType = modelTypesByVersionId[row.modelVersionId] || row.modelVersionTag || '';

    const features = Array.isArray(row.topFeatures) ? row.topFeatures.slice(0, 5) : [];
    const topF = [0, 1, 2, 3, 4].map((i) => formatTopFeature(features[i]));

    return [
      row.predictionRunId ?? '',
      row.createdAt ?? '',
      modelType,
      row.modelVersionTag ?? '',
      row.runtimeModelVersion ?? '',
      row.crop ?? '',
      row.variety ?? '',
      row.season ?? '',
      row.state ?? '',
      row.county ?? '',
      Number.isFinite(row.acres) ? row.acres : '',
      Number.isFinite(row.totalN) ? row.totalN : '',
      Number.isFinite(row.totalP) ? row.totalP : '',
      Number.isFinite(row.totalK) ? row.totalK : '',
      Number.isFinite(row.waterApplied) ? row.waterApplied : '',
      Number.isFinite(predicted) ? predicted.toFixed(4) : '',
      Number.isFinite(lower) ? lower.toFixed(4) : '',
      Number.isFinite(upper) ? upper.toFixed(4) : '',
      Number.isFinite(width) ? width.toFixed(4) : '',
      Number.isFinite(row.confidenceLevel) && row.confidenceLevel > 0 ? (row.confidenceLevel * 100).toFixed(0) : '',
      Number.isFinite(regional) ? regional.toFixed(4) : '',
      regionalSource,
      Number.isFinite(regionalDelta) ? regionalDelta.toFixed(2) : '',
      ...topF
    ];
  });

  return [header, ...body];
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
      // Newer payloads carry the model's actual coverage level (e.g. 0.90 for
      // a CatBoost q=0.05/q=0.95 ensemble). Older rows return null, and the
      // UI falls back to the generic "Confidence interval" label.
      confidenceLevel: toNumberOrNull(row.confidence_level ?? responsePayload?.confidence_level),
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

function MetricCard({ label, value, unit, helper, helperColor, range, comparison, info }) {
  const theme = useTheme();
  // Reused themed tooltip styling so every info-icon tooltip inside this
  // card reads as part of the Overview tab's blue-on-dark family rather
  // than the default MUI gray.
  const themedTooltipSlotProps = info
    ? {
        tooltip: {
          sx: {
            bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})`,
            color: theme.palette.common.white,
            border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
            fontSize: '0.74rem',
            fontWeight: 500,
            maxWidth: 320,
            px: 1.5,
            py: 1.1,
            borderRadius: 1.25,
            boxShadow: `0 6px 16px ${alpha(theme.palette.common.black, 0.45)}`
          }
        },
        arrow: {
          sx: {
            color: `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})`,
            '&::before': {
              backgroundColor: `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})`,
              border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`
            }
          }
        }
      }
    : null;

  // Compare visualization for the Regional Average card: a horizontal bar
  // anchored to the regional value (center) with the predicted value plotted
  // relative to it. Direction (up/down) and tone (success/warning) are
  // driven by sign so a glance tells you whether this prediction outperforms
  // the regional baseline. Bounded to ±50% so an outlier prediction doesn't
  // visually destroy the bar — anything beyond clamps to the edge with a
  // direction arrow so the user still sees the polarity.
  let comparisonBlock = null;
  if (
    comparison &&
    Number.isFinite(Number(comparison.predicted)) &&
    Number.isFinite(Number(comparison.regional)) &&
    Number(comparison.regional) > 0
  ) {
    const predicted = Number(comparison.predicted);
    const regional = Number(comparison.regional);
    const deltaPct = ((predicted - regional) / regional) * 100;
    const sign = deltaPct >= 0 ? '+' : '';
    const isAbove = deltaPct >= 0;
    const tone = isAbove ? theme.palette.success.light : theme.palette.warning.light;
    // Map [-50%, +50%] → [0%, 100%]; clamp anything outside that band.
    const markerPct = Math.max(0, Math.min(100, 50 + deltaPct));
    const DirIcon = isAbove ? RiseOutlined : FallOutlined;
    comparisonBlock = (
      <Box sx={{ pt: 0.75 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', mb: 0.5 }}>
          <Typography
            sx={{
              color: alpha(theme.palette.common.white, 0.5),
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase'
            }}
          >
            Regional
          </Typography>
          <Typography
            sx={{
              color: alpha(theme.palette.common.white, 0.5),
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase'
            }}
          >
            Predicted
          </Typography>
        </Stack>
        <Box
          sx={{
            position: 'relative',
            height: 6,
            borderRadius: 999,
            background: `linear-gradient(90deg,
              ${alpha(theme.palette.warning.light, 0.35)} 0%,
              ${alpha(theme.palette.common.white, 0.18)} 50%,
              ${alpha(theme.palette.success.light, 0.35)} 100%)`,
            border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
            overflow: 'visible'
          }}
        >
          {/* Center tick = regional baseline */}
          <Box
            sx={{
              position: 'absolute',
              left: '50%',
              top: -3,
              transform: 'translateX(-50%)',
              width: 2,
              height: 12,
              bgcolor: alpha(theme.palette.common.white, 0.5),
              borderRadius: 1
            }}
          />
          {/* Predicted marker — colored by direction so polarity is encoded
              in both position and hue. */}
          <Box
            sx={{
              position: 'absolute',
              left: `${markerPct}%`,
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 12,
              height: 12,
              borderRadius: '50%',
              bgcolor: theme.palette.common.white,
              border: `2px solid ${tone}`,
              boxShadow: `0 0 0 3px ${alpha(tone, 0.28)}, 0 0 8px ${alpha(tone, 0.55)}`
            }}
          />
        </Box>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mt: 1.25 }}>
          <Box sx={{ color: tone, display: 'flex', alignItems: 'center', fontSize: '0.85rem' }}>
            <DirIcon />
          </Box>
          <Typography sx={{ color: tone, fontWeight: 700, fontSize: '0.82rem', fontVariantNumeric: 'tabular-nums' }}>
            {sign}
            {deltaPct.toFixed(1)}%
          </Typography>
          <Typography sx={{ color: alpha(theme.palette.common.white, 0.55), fontSize: '0.75rem', fontWeight: 500 }}>
            {isAbove ? 'above' : 'below'} regional avg
          </Typography>
        </Stack>
      </Box>
    );
  }

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
        <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
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
          {info ? (
            <Tooltip arrow placement="top" title={info} slotProps={themedTooltipSlotProps}>
              <Box
                component="span"
                tabIndex={0}
                aria-label={`About ${label}`}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'help',
                  color: alpha(theme.palette.primary.light, 0.7),
                  fontSize: '0.78rem',
                  transition: 'color 0.15s ease',
                  '&:hover, &:focus-visible': { color: theme.palette.primary.light, outline: 'none' }
                }}
              >
                <InfoCircleOutlined />
              </Box>
            </Tooltip>
          ) : null}
        </Stack>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline', flexWrap: 'wrap', rowGap: 0.25 }}>
          <Typography component="span" sx={{ color: theme.palette.common.white, fontWeight: 700, fontSize: '1.5rem', lineHeight: 1.15 }}>
            {value}
          </Typography>
          {unit ? (
            <Typography component="span" sx={{ color: alpha(theme.palette.common.white, 0.55), fontWeight: 500, fontSize: '0.85rem' }}>
              {unit}
            </Typography>
          ) : null}
        </Stack>
        {rangeMarker}
        {comparisonBlock}
        {helper && !comparisonBlock ? (
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

  // Pulls the aggregate prediction stats straight from /fields/overview.
  // These already combine field-season-level predictions (ModelPrediction
  // table, populated by the backfill) with ad-hoc PredictionRun rows from
  // the wizard, so the card reflects the true model footprint across the
  // dataset rather than just the interactive history.
  const stats = overview?.prediction_stats || {};
  const totalFieldSeasons = overview?.total_field_seasons || 0;
  const withPredictions = stats.field_seasons_with_predictions || 0;
  const coveragePct = totalFieldSeasons ? (100 * withPredictions) / totalFieldSeasons : 0;
  const fieldPredictionsTotal = stats.field_predictions_total || 0;

  // Color for the coverage bar — escalates from neutral info to warning to
  // success as coverage improves. Same thresholds the Overview's previous
  // Coverage card used so the visual story is preserved across the move.
  const coverageBarColor =
    coveragePct >= 90 ? theme.palette.success.main : coveragePct >= 75 ? theme.palette.warning.main : theme.palette.info.main;

  // The four headline stats. Held in a config array so the JSX stays
  // declarative and the layout is trivially extensible — drop in a new
  // metric here and it slots into the grid without restructuring.
  const stats4 = [
    { label: 'Total Predictions', value: (stats.total_predictions || 0).toLocaleString(), unit: null },
    { label: 'Avg Predicted', value: (stats.predicted_yield_avg || 0).toFixed(1), unit: 'bu/ac' },
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
            {fieldPredictionsTotal.toLocaleString()} field predictions
          </Typography>
          {lastRunRelative ? (
            <>
              <Box component="span" aria-hidden sx={{ color: alpha(theme.palette.common.white, 0.3), fontSize: '0.75rem' }}>
                ·
              </Box>
              <Tooltip title={lastRunAt ? `Last run: ${new Date(lastRunAt).toLocaleString()}` : ''} arrow placement="top">
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
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '0.75rem',
                letterSpacing: '0.01em',
                minHeight: 0,
                py: 0.15,
                // Symmetric horizontal padding + centered content so the
                // label sits visually centered inside the pill. The
                // previous endIcon (a small chevron) pulled the text off
                // center because `text + icon` were centered as a unit,
                // making the label itself read as skewed left of center.
                px: 1.25,
                borderRadius: 999,
                justifyContent: 'center',
                textAlign: 'center',
                color: alpha(theme.palette.primary.light, 0.95),
                bgcolor: 'transparent',
                border: `1px solid ${alpha(theme.palette.primary.main, 0.4)}`,
                transition: 'background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease',
                '&:hover': {
                  color: theme.palette.common.white,
                  bgcolor: alpha(theme.palette.primary.main, 0.18),
                  borderColor: theme.palette.primary.main,
                  boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.18)}`
                }
              }}
            >
              View run history
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
                  sm: idx < stats4.length - 1 ? `1px solid ${alpha(theme.palette.primary.light, 0.18)}` : 'none'
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
  // Themed BarChart sx — axes, grid lines, tick lines, and bar surface all
  // pulled into the Overview tab's blue-on-dark palette. The bars get a
  // subtle stroke + primary glow so they read as a tactile element rather
  // than flat rectangles, and the axes/grid use primary-alpha so they
  // recede behind the data instead of competing with it. Both axes are
  // styled identically so the chart reads the same whether bars are
  // vertical or horizontal.
  const chartBarSx = {
    '& .MuiBarElement-root': {
      stroke: alpha(theme.palette.common.white, 0.18),
      strokeWidth: 1,
      filter: `drop-shadow(0 2px 6px ${alpha(theme.palette.primary.main, 0.35)})`,
      transition: 'opacity 0.18s ease, filter 0.18s ease',
      '&:hover': {
        opacity: 0.92,
        filter: `drop-shadow(0 3px 10px ${alpha(theme.palette.primary.main, 0.55)})`
      }
    },
    // Category-label axis (bottom for vertical bars, left for horizontal
    // bars) — bold white labels so category names are immediately readable.
    '& .MuiChartsAxis-bottom, & .MuiChartsAxis-left': {
      '& .MuiChartsAxis-line': { stroke: alpha(theme.palette.primary.main, 0.35) },
      '& .MuiChartsAxis-tickLabel': {
        fill: `${alpha(theme.palette.common.white, 0.85)} !important`,
        fontSize: '0.8rem !important',
        fontWeight: '700 !important',
        letterSpacing: '0.04em'
      },
      '& .MuiChartsAxis-tick': { stroke: alpha(theme.palette.primary.main, 0.4) }
    },
    // Numeric-scale axis labels (whichever side is currently the value axis)
    // — dimmer + tabular numerals so the scale stays subordinate to the bars.
    '& .MuiChartsAxis-bottom .MuiChartsAxis-tickLabel[data-is-value-axis="true"], & .MuiChartsAxis-left .MuiChartsAxis-tickLabel[data-is-value-axis="true"]':
      {
        fill: `${alpha(theme.palette.common.white, 0.55)} !important`,
        fontSize: '0.72rem !important',
        fontVariantNumeric: 'tabular-nums'
      },
    // Both grid orientations — barely-visible dashed primary alpha so the
    // eye can align bar lengths without the chart feeling busy.
    '& .MuiChartsGrid-horizontalLine, & .MuiChartsGrid-verticalLine': {
      stroke: alpha(theme.palette.primary.main, 0.12),
      strokeDasharray: '3 3'
    },
    // Axis titles ("Yield bu/ac" / "Input Amount") — primary-light so they
    // pop against the dark surface and read as a chart-level label rather
    // than a tick.
    '& .MuiChartsAxis-label': {
      fill: `${alpha(theme.palette.primary.light, 0.95)} !important`,
      fontSize: '0.78rem !important',
      fontWeight: '700 !important',
      letterSpacing: '0.06em',
      textTransform: 'uppercase'
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
  // Per-state aggregate stats (count, avg_yield, etc.) — same source the
  // Overview tab's FieldMapPreview uses. Lets the analyzed-prediction
  // drawer fall back to a state-level regional baseline when the
  // prediction's own regional_comparison comes back empty.
  const [stateStats, setStateStats] = useState({});
  // Nutrient palette — three progressive primary shades so the bars read
  // as a coherent N/P/K trio rather than three unrelated colors.
  const nutrientBarColors = [theme.palette.primary.light, theme.palette.primary.main, theme.palette.primary.dark];
  // Yield-context palette — semantic ordering: warning.light at the low
  // end of the CI, primary at the predicted value (the headline), success.light
  // at the high end of the CI, and a muted neutral for the regional reference
  // bar so it reads as "comparison context" rather than another yield value.
  const yieldBarColors = [
    theme.palette.warning.light,
    theme.palette.primary.main,
    theme.palette.success.light,
    alpha(theme.palette.common.white, 0.4)
  ];

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
        // Scope the macro Model Performance card to CatBoost-family
        // predictions only. The backend does a case-insensitive substring
        // match against ModelVersion.model_type, so this also catches
        // tagged variants like "catboost_v3" while excluding
        // deep-learning rows (which were inflating the aggregate stats
        // with out-of-range predicted yields).
        const response = await fetch(`${API_BASE_URL}/fields/overview?model_type=catboost`, { signal: controller.signal });
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

  // Load per-state aggregates (same endpoint Overview's FieldMapPreview hits)
  // so the analyzed-prediction drawer can fall back to a state-level regional
  // avg when the prediction-time regional_comparison is null (e.g. when
  // county-level data was unavailable at predict time).
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
          // Silent — we'll just show "baseline unavailable" if both sources are empty.
        }
      }
    };
    loadStateStats();
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
    // Fall back to the state-level avg when the prediction's own
    // regional_comparison was empty — keeps the Regional Avg bar from
    // rendering as a flat zero when county-level data is missing.
    let regional = analyzedPrediction.regionalAvgYield;
    if (!Number.isFinite(regional) || regional <= 0) {
      const stateRow = analyzedPrediction.state ? stateStats[analyzedPrediction.state] : null;
      const stateAvg = stateRow != null ? Number(stateRow.avg_yield) : null;
      if (Number.isFinite(stateAvg) && stateAvg > 0) regional = stateAvg;
    }
    return [
      analyzedPrediction.confidenceLower ?? 0,
      analyzedPrediction.predictedYield ?? 0,
      analyzedPrediction.confidenceUpper ?? 0,
      regional ?? 0
    ];
  }, [analyzedPrediction, stateStats]);

  const handleAnalyzePrediction = () => {
    if (!selectedPrediction) return;
    setAnalyzedPrediction(selectedPrediction);
  };

  // Sub-navigation: the Analytics tab is split into two task-shaped views
  // selected via a ToggleButtonGroup at the top.
  //   'predictions' — Saved Predictions table + analyzed-prediction drawer
  //                   (the action-oriented working surface)
  //   'model-data'  — Model Performance card + regression scatter + Field
  //                   Records table (the reference-oriented context view).
  // Defaults to 'model-data' so the first thing the user sees in Analytics
  // is the model's track record and the regression diagnostic.
  const [analyticsView, setAnalyticsView] = useState('model-data');

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
  // at its tiny 84×24 footprint. Only CatBoost runs feed the timeline so
  // it matches the CatBoost-only stats shown elsewhere on this card.
  const predictionTimeline = useMemo(() => {
    if (!Array.isArray(predictionRuns) || predictionRuns.length === 0) return null;
    const valid = predictionRuns.filter((r) => {
      if (!r?.createdAt || !Number.isFinite(Number(r?.predictedYield))) return false;
      const modelKey = String(modelTypesByVersionId[r.modelVersionId] || r.modelVersionTag || '').toLowerCase();
      return modelKey.includes('catboost') || modelKey.includes('lgbm') || modelKey.includes('lightgbm') || modelKey.includes('boost');
    });
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
  }, [predictionRuns, modelTypesByVersionId]);

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
            <ToggleButton value="model-data">Model &amp; Data</ToggleButton>
            <ToggleButton value="predictions">Predictions</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {/* ===================== VIEW A — PREDICTIONS ===================== */}
        {analyticsView === 'predictions' ? (
          <>
            {/* Header + context block above the table. Frames the view as
                an active "use the model to predict yield" workflow rather
                than a passive log: the heading states the user-facing
                action, the description explains how to operate it (pick a
                row of inputs → run the model → inspect the prediction in
                the drawer). Without the heading, users could mistake this
                view for a read-only history page. */}
            <Stack spacing={0.75}>
              <Typography
                variant="h4"
                sx={{
                  fontWeight: 700,
                  color: theme.palette.common.white,
                  lineHeight: 1.2,
                  letterSpacing: '0.01em'
                }}
              >
                Make a Yield Prediction
              </Typography>
              <Typography
                variant="body1"
                sx={{
                  color: alpha(theme.palette.common.white, 0.7),
                  fontSize: '0.95rem',
                  maxWidth: 760,
                  lineHeight: 1.55
                }}
              >
                Use the model to predict yield for any of your fields. Select a saved input set from the table below and click{' '}
                <Box component="span" sx={{ fontWeight: 700, color: theme.palette.common.white }}>
                  Analyze Prediction
                </Box>{' '}
                to run the model on those values — you&apos;ll see the predicted yield, confidence interval, and which inputs drove the
                result.
              </Typography>
            </Stack>

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
                  <Tooltip
                    title={predictionRuns.length > 0 ? 'Download CSV of all rows (with drawer details)' : 'No predictions to download'}
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
                      aria-label="Download saved predictions as CSV"
                      disabled={predictionRuns.length === 0}
                      onClick={() => {
                        if (predictionRuns.length === 0) return;
                        const cells = buildPredictionRunsCsv(predictionRuns, modelTypesByVersionId, stateStats);
                        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                        downloadCsv(cells, `traitharvest-predictions-${stamp}.csv`);
                      }}
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
                        },
                        '&.Mui-disabled': {
                          color: alpha(theme.palette.common.white, 0.25),
                          borderColor: alpha(theme.palette.primary.main, 0.15),
                          bgcolor: alpha(theme.palette.primary.main, 0.05)
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
                            <Radio size="small" checked={isSelected} onChange={() => setSelectedPredictionRunId(row.predictionRunId)} />
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
                  disabled={!selectedPrediction || isLoading}
                  onClick={handleAnalyzePrediction}
                  endIcon={
                    <Box component="span" aria-hidden sx={{ fontSize: '0.95rem', lineHeight: 1 }}>
                      →
                    </Box>
                  }
                  sx={{
                    textTransform: 'none',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    letterSpacing: '0.01em',
                    px: 2,
                    py: 0.65,
                    borderRadius: 999,
                    color: alpha(theme.palette.primary.light, 0.95),
                    bgcolor: alpha(theme.palette.primary.main, 0.18),
                    border: `1px solid ${alpha(theme.palette.primary.main, 0.55)}`,
                    transition: 'background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease',
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
                  Analyze Prediction
                </Button>
              </Stack>
            </Paper>

            {!analyzedPrediction ? (
              <Alert
                severity="info"
                variant="outlined"
                sx={{
                  backgroundColor: alpha(theme.palette.primary.main, 0.12),
                  borderColor: alpha(theme.palette.primary.main, 0.45),
                  color: alpha(theme.palette.common.white, 0.85),
                  borderRadius: 2,
                  '& .MuiAlert-icon': {
                    color: alpha(theme.palette.primary.light, 0.95)
                  },
                  '& .MuiAlert-message': {
                    color: alpha(theme.palette.common.white, 0.85),
                    fontWeight: 500
                  },
                  '& .MuiAlert-message strong': {
                    color: theme.palette.primary.light,
                    fontWeight: 700
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
                          <Chip
                            label={`Crop: ${analyzedPrediction.crop ? formatCropName(analyzedPrediction.crop) : 'Unknown'}`}
                            sx={outlinedChipSx}
                          />
                          <Chip label={`Season: ${analyzedPrediction.season ?? 'Unknown'}`} sx={outlinedChipSx} />
                        </Stack>
                      );
                    })()}

                    {(() => {
                      const lower = analyzedPrediction.confidenceLower;
                      const upper = analyzedPrediction.confidenceUpper;
                      const predicted = analyzedPrediction.predictedYield;
                      // Prefer the prediction's own regional_comparison (county-level
                      // when available, computed at predict time). Fall back to the
                      // state-level avg from /fields/states/stats/ — same source the
                      // Overview tab's FieldMap uses — so the user almost never sees
                      // an empty baseline when the state is known.
                      let regional = analyzedPrediction.regionalAvgYield;
                      let regionalSource = regional != null ? 'county' : null;
                      if (!Number.isFinite(regional) || regional <= 0) {
                        const stateName = analyzedPrediction.state;
                        const stateRow = stateName ? stateStats[stateName] : null;
                        const stateAvg = stateRow != null ? Number(stateRow.avg_yield) : null;
                        if (Number.isFinite(stateAvg) && stateAvg > 0) {
                          regional = stateAvg;
                          regionalSource = 'state';
                        }
                      }
                      const hasInterval = Number.isFinite(lower) && Number.isFinite(upper) && upper > lower;
                      const hasRegional = Number.isFinite(regional) && regional > 0 && Number.isFinite(predicted);
                      // Backend-reported coverage fraction (0.95 for Gaussian DL,
                      // 0.90 for CatBoost q=0.05/q=0.95 ensembles, etc). Falls back
                      // to a generic label for older rows missing the field.
                      const confidenceLevel = analyzedPrediction.confidenceLevel;
                      const confidenceLabel =
                        Number.isFinite(confidenceLevel) && confidenceLevel > 0
                          ? `${Math.round(confidenceLevel * 100)}% confidence interval`
                          : "Model's confidence interval";

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

                      const regionalSampleSize = (() => {
                        const r = analyzedPrediction.responsePayload?.regional_comparison;
                        const n = r && Number(r.sample_size);
                        if (regionalSource === 'county' && Number.isFinite(n) && n > 0) return n;
                        const stateRow = analyzedPrediction.state ? stateStats[analyzedPrediction.state] : null;
                        const stateN = stateRow != null ? Number(stateRow.field_count ?? stateRow.count) : null;
                        if (regionalSource === 'state' && Number.isFinite(stateN) && stateN > 0) return stateN;
                        return null;
                      })();

                      return (
                        <Grid container spacing={2}>
                          <Grid size={{ xs: 12, md: 6 }}>
                            <MetricCard
                              label="Predicted Yield"
                              value={formatNumber(predicted)}
                              unit="bu/ac"
                              // Helper text reflects the model's actual coverage
                              // (confidence_level, e.g. 0.90 for a CatBoost
                              // q=0.05/q=0.95 ensemble or 0.95 for a Gaussian DL
                              // uncertainty head). Older predictions without the
                              // field fall back to the generic label.
                              helper={`${confidenceLabel} (bu/ac)`}
                              range={hasInterval ? { min: lower, max: upper, value: predicted } : null}
                              info={
                                <Box sx={{ p: 0.25 }}>
                                  <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5, color: 'inherit' }}>
                                    Predicted yield
                                  </Typography>
                                  <Typography sx={{ fontSize: '0.74rem', lineHeight: 1.5, color: 'inherit', mb: 0.5 }}>
                                    The model's point estimate (typically its median quantile or mean output) in bushels per acre, for the
                                    inputs you submitted.
                                  </Typography>
                                  <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.45, color: 'inherit', opacity: 0.85 }}>
                                    The horizontal bar plots where the prediction falls inside the model's confidence interval. The bounds
                                    come live from the model — quantile predictions for tree ensembles, or mean ± 1.96·σ for DL models with
                                    an uncertainty head.
                                  </Typography>
                                </Box>
                              }
                            />
                          </Grid>
                          <Grid size={{ xs: 12, md: 6 }}>
                            <MetricCard
                              label="Confidence Width"
                              value={hasInterval ? formatNumber(upper - lower) : '—'}
                              unit={hasInterval ? 'bu/ac' : null}
                              // Same range-bar visualization as Predicted Yield but
                              // with no marker — the bar IS the width here, with
                              // its endpoints labeled so the user can read both
                              // bounds visually rather than scanning the helper text.
                              range={hasInterval ? { min: lower, max: upper } : null}
                              helper={hasInterval ? `Range: ${formatNumber(lower)} — ${formatNumber(upper)}` : null}
                              info={
                                <Box sx={{ p: 0.25 }}>
                                  <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5, color: 'inherit' }}>
                                    Confidence width
                                  </Typography>
                                  <Typography sx={{ fontSize: '0.74rem', lineHeight: 1.5, color: 'inherit', mb: 0.5 }}>
                                    Upper bound minus lower bound (bu/ac). A{' '}
                                    <Box component="span" sx={{ fontWeight: 700 }}>
                                      narrower
                                    </Box>{' '}
                                    width means the model is more confident about this specific input.
                                  </Typography>
                                  <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.45, color: 'inherit', opacity: 0.85 }}>
                                    Use this to compare runs: two predictions can have the same yield but very different uncertainty. Wider
                                    intervals usually point to inputs that are unusual relative to the training data.
                                  </Typography>
                                </Box>
                              }
                            />
                          </Grid>
                          <Grid size={{ xs: 12, md: 6 }}>
                            <MetricCard
                              label={`Regional Average${analyzedPrediction.state ? ` · ${analyzedPrediction.state}` : ''}`}
                              value={hasRegional ? formatNumber(regional) : '—'}
                              unit={hasRegional ? 'bu/ac' : null}
                              // Compare block (mini bar + delta + arrow) renders when
                              // both numbers are present. The free-text helper
                              // remains as a fallback for the no-regional-data case.
                              comparison={hasRegional ? { predicted, regional } : null}
                              helper={!hasRegional ? 'Regional baseline unavailable' : null}
                              helperColor={regionalHelperColor}
                              info={
                                <Box sx={{ p: 0.25 }}>
                                  <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5, color: 'inherit' }}>
                                    Regional average yield
                                  </Typography>
                                  <Typography sx={{ fontSize: '0.74rem', lineHeight: 1.5, color: 'inherit', mb: 0.5 }}>
                                    Average observed yield from your historical field records in this region. We try the prediction's{' '}
                                    <Box component="span" sx={{ fontWeight: 700 }}>
                                      county
                                    </Box>{' '}
                                    first (computed at predict time), then fall back to the{' '}
                                    <Box component="span" sx={{ fontWeight: 700 }}>
                                      state
                                    </Box>{' '}
                                    aggregate (the same source the Overview tab's FieldMap uses).
                                  </Typography>
                                  <Typography sx={{ fontSize: '0.74rem', lineHeight: 1.5, color: 'inherit', mb: 0.5 }}>
                                    The mini-bar shows where the prediction sits relative to this baseline. A green marker to the right
                                    means the model expects this input to outperform the regional average; a yellow marker to the left means
                                    it expects to underperform.
                                  </Typography>
                                  {regionalSource ? (
                                    <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.45, color: 'inherit', opacity: 0.85 }}>
                                      Source:{' '}
                                      <Box component="span" sx={{ fontWeight: 700 }}>
                                        {regionalSource === 'county' ? 'county-level' : 'state-level'}
                                      </Box>{' '}
                                      {regionalSampleSize ? `· n = ${regionalSampleSize.toLocaleString()} field-seasons` : null}
                                    </Typography>
                                  ) : null}
                                </Box>
                              }
                            />
                          </Grid>
                          <Grid size={{ xs: 12, md: 6 }}>
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
                      // Re-derive the yield-context numbers locally — they're scoped
                      // to the metrics-row IIFE above and aren't visible here.
                      const lower = analyzedPrediction.confidenceLower;
                      const upper = analyzedPrediction.confidenceUpper;
                      const predicted = analyzedPrediction.predictedYield;
                      let regional = analyzedPrediction.regionalAvgYield;
                      if (!Number.isFinite(regional) || regional <= 0) {
                        const stateName = analyzedPrediction.state;
                        const stateRow = stateName ? stateStats[stateName] : null;
                        const stateAvg = stateRow != null ? Number(stateRow.avg_yield) : null;
                        if (Number.isFinite(stateAvg) && stateAvg > 0) regional = stateAvg;
                      }
                      const hasInterval = Number.isFinite(lower) && Number.isFinite(upper) && upper > lower;
                      const hasRegional = Number.isFinite(regional) && regional > 0;

                      // Fixed inner content height for both chart cards — accommodates the
                      // BarChart's SVG plus any legend/axis padding so the chart and
                      // the empty state always render at the same total height. Taller
                      // than before so the bars get the breathing room they need at
                      // the drawer's width.
                      const chartContentHeight = 380;
                      // Match the SVG height to the wrapping Box's content area so the
                      // BarChart fills the card vertically with no dead space below.
                      // The wrapping Box uses px: 0, py: 0 (no vertical padding), so
                      // the SVG height equals the Box's full height.
                      const chartSvgHeight = chartContentHeight;
                      const chartCardSx = {
                        bgcolor: alpha(theme.palette.primary.main, 0.14),
                        border: `1px solid ${alpha(theme.palette.primary.main, 0.45)}`,
                        borderRadius: 2,
                        backgroundImage: 'none',
                        boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.35)}`,
                        // Stretch the card to fill its Grid item so siblings equalize
                        // even if one card's intrinsic content is taller than the other.
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        '& .MuiCardHeader-root': {
                          bgcolor: alpha(theme.palette.primary.main, 0.12),
                          borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
                          px: 2.5,
                          py: 1.5
                        },
                        '& .MuiCardHeader-title': {
                          color: theme.palette.common.white,
                          fontWeight: 700,
                          letterSpacing: '0.01em',
                          fontSize: '0.95rem'
                        }
                      };

                      return (
                        <Grid container spacing={2}>
                          <Grid size={{ xs: 12 }}>
                            <MainCard title="Yield Context" content={false} sx={chartCardSx}>
                              {/* Edge-to-edge horizontal padding so the SVG fills
                          the card. Internal margins are tuned so the Y-axis
                          title fits at left and tick labels at bottom — no
                          extra slack. */}
                              <Box sx={{ px: 0, py: 0, height: chartContentHeight, boxSizing: 'border-box' }}>
                                <BarChart
                                  height={chartSvgHeight}
                                  hideLegend
                                  sx={chartBarSx}
                                  margin={{ top: 8, right: 12, bottom: 8, left: 8 }}
                                  grid={{ horizontal: true }}
                                  xAxis={[
                                    {
                                      scaleType: 'band',
                                      data: YIELD_CATEGORIES,
                                      colorMap: { type: 'ordinal', values: YIELD_CATEGORIES, colors: yieldBarColors },
                                      categoryGapRatio: 0.35,
                                      barGapRatio: 0.1
                                    }
                                  ]}
                                  yAxis={[
                                    {
                                      valueFormatter: (v) => formatNumber(v, 1),
                                      label: 'Yield bu/ac',
                                      width: 64
                                    }
                                  ]}
                                  series={[
                                    {
                                      data: yieldContextSeries,
                                      valueFormatter: (v) => `${formatNumber(v, 2)} bu/ac`
                                    }
                                  ]}
                                  borderRadius={10}
                                />
                              </Box>
                            </MainCard>
                          </Grid>
                          <Grid size={{ xs: 12 }}>
                            <MainCard title="Nutrient Inputs" content={false} sx={chartCardSx}>
                              {hasNutrients ? (
                                <Box sx={{ px: 0, py: 0, height: chartContentHeight, boxSizing: 'border-box' }}>
                                  <BarChart
                                    height={chartSvgHeight}
                                    hideLegend
                                    sx={chartBarSx}
                                    margin={{ top: 8, right: 12, bottom: 8, left: 8 }}
                                    grid={{ horizontal: true }}
                                    xAxis={[
                                      {
                                        scaleType: 'band',
                                        data: NUTRIENT_CATEGORIES,
                                        colorMap: { type: 'ordinal', values: NUTRIENT_CATEGORIES, colors: nutrientBarColors },
                                        categoryGapRatio: 0.35,
                                        barGapRatio: 0.1
                                      }
                                    ]}
                                    yAxis={[
                                      {
                                        valueFormatter: (v) => formatNumber(v, 1),
                                        label: 'Input Amount',
                                        width: 64
                                      }
                                    ]}
                                    series={[
                                      {
                                        data: nutrientSeries,
                                        valueFormatter: (v) => formatNumber(v, 2)
                                      }
                                    ]}
                                    borderRadius={10}
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
                        p: { xs: 2, md: 2.5 },
                        borderRadius: 2,
                        bgcolor: alpha(theme.palette.primary.main, 0.14),
                        borderColor: alpha(theme.palette.primary.main, 0.45),
                        boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.35)}`
                      }}
                    >
                      <Stack spacing={2}>
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
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
                              fontSize: '1.1rem'
                            }}
                          >
                            <ThunderboltOutlined />
                          </Box>
                          <Stack spacing={0.1} sx={{ flex: 1, minWidth: 0 }}>
                            <Typography
                              sx={{ color: theme.palette.common.white, fontWeight: 700, fontSize: '0.95rem', letterSpacing: '0.02em' }}
                            >
                              Top Contributing Features
                            </Typography>
                            <Typography sx={{ color: alpha(theme.palette.common.white, 0.6), fontSize: '0.76rem', fontWeight: 500 }}>
                              Ranked by SHAP impact
                              {analyzedPrediction.topFeatures.length > 0
                                ? ` · ${analyzedPrediction.topFeatures.length} feature${analyzedPrediction.topFeatures.length === 1 ? '' : 's'}`
                                : ''}
                            </Typography>
                          </Stack>
                          <Tooltip
                            arrow
                            placement="left"
                            title={
                              <Box sx={{ p: 0.25 }}>
                                <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5, color: 'inherit' }}>
                                  About direction & impact
                                </Typography>
                                <Typography sx={{ fontSize: '0.74rem', lineHeight: 1.5, color: 'inherit', mb: 0.75 }}>
                                  <Box component="span" sx={{ color: theme.palette.success.light, fontWeight: 700 }}>
                                    Positive
                                  </Box>{' '}
                                  features pushed this prediction{' '}
                                  <Box component="span" sx={{ fontWeight: 700 }}>
                                    up
                                  </Box>{' '}
                                  from the model's baseline — they made the predicted yield higher than the model's average expectation.
                                </Typography>
                                <Typography sx={{ fontSize: '0.74rem', lineHeight: 1.5, color: 'inherit', mb: 0.75 }}>
                                  <Box component="span" sx={{ color: theme.palette.warning.light, fontWeight: 700 }}>
                                    Negative
                                  </Box>{' '}
                                  features pulled it{' '}
                                  <Box component="span" sx={{ fontWeight: 700 }}>
                                    down
                                  </Box>{' '}
                                  — they made the prediction lower than the baseline.
                                </Typography>
                                <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.45, color: 'inherit', opacity: 0.85 }}>
                                  <Box component="span" sx={{ fontWeight: 700 }}>
                                    Impact
                                  </Box>{' '}
                                  is the share of total |SHAP| value this feature owns. The bar visualizes that share so longer bars carry
                                  more of the explanation.
                                </Typography>
                              </Box>
                            }
                            slotProps={{
                              tooltip: {
                                sx: {
                                  bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})`,
                                  color: theme.palette.common.white,
                                  border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
                                  fontSize: '0.74rem',
                                  fontWeight: 500,
                                  maxWidth: 320,
                                  px: 1.5,
                                  py: 1.1,
                                  borderRadius: 1.25,
                                  boxShadow: `0 6px 16px ${alpha(theme.palette.common.black, 0.45)}`
                                }
                              },
                              arrow: {
                                sx: {
                                  color: `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})`,
                                  '&::before': {
                                    backgroundColor: `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})`,
                                    border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`
                                  }
                                }
                              }
                            }}
                          >
                            <Box
                              component="span"
                              tabIndex={0}
                              aria-label="About direction and impact"
                              sx={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'help',
                                color: alpha(theme.palette.primary.light, 0.7),
                                fontSize: '0.95rem',
                                flexShrink: 0,
                                '&:hover, &:focus-visible': { color: theme.palette.primary.light, outline: 'none' }
                              }}
                            >
                              <InfoCircleOutlined />
                            </Box>
                          </Tooltip>
                        </Stack>

                        {/* Compact legend strip clarifying positive/negative tone
                    inline so the meaning is visible without hover. */}
                        {analyzedPrediction.topFeatures.length > 0 ? (
                          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                            <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
                              <Box sx={{ color: theme.palette.success.light, display: 'flex', fontSize: '0.85rem' }}>
                                <RiseOutlined />
                              </Box>
                              <Typography sx={{ color: alpha(theme.palette.common.white, 0.75), fontSize: '0.72rem', fontWeight: 600 }}>
                                Positive = pushed yield up
                              </Typography>
                            </Stack>
                            <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
                              <Box sx={{ color: theme.palette.warning.light, display: 'flex', fontSize: '0.85rem' }}>
                                <FallOutlined />
                              </Box>
                              <Typography sx={{ color: alpha(theme.palette.common.white, 0.75), fontSize: '0.72rem', fontWeight: 600 }}>
                                Negative = pulled yield down
                              </Typography>
                            </Stack>
                          </Stack>
                        ) : null}

                        <TableContainer sx={{ border: 1, borderColor: accentBlue, borderRadius: 1.25, ...tableScrollbarSx }}>
                          <Table size="small" sx={{ minWidth: 760 }}>
                            <TableHead>
                              <TableRow
                                sx={{
                                  '& .MuiTableCell-root': {
                                    bgcolor: headerBlue,
                                    borderBottomColor: accentBlue,
                                    borderBottomWidth: 2,
                                    color: alpha(theme.palette.common.white, 0.85),
                                    whiteSpace: 'nowrap',
                                    fontWeight: 700,
                                    fontSize: '0.72rem',
                                    letterSpacing: '0.08em',
                                    textTransform: 'uppercase'
                                  }
                                }}
                              >
                                <TableCell>Feature</TableCell>
                                <TableCell>Value</TableCell>
                                <TableCell>Direction</TableCell>
                                <TableCell align="right">Impact</TableCell>
                                <TableCell sx={{ minWidth: 180 }}>Contribution</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {analyzedPrediction.topFeatures.length > 0 ? (
                                analyzedPrediction.topFeatures.map((feature, index) => {
                                  const importance = Math.max(toNumberOrNull(feature?.importance) || 0, 0);
                                  const barPct = Math.min(importance * 100, 100);
                                  const directionKey = String(feature?.direction || '').toLowerCase();
                                  const isPositive = directionKey === 'positive';
                                  const isNegative = directionKey === 'negative';
                                  const dirTone = isPositive
                                    ? theme.palette.success.light
                                    : isNegative
                                      ? theme.palette.warning.light
                                      : alpha(theme.palette.common.white, 0.55);
                                  const DirIcon = isNegative ? FallOutlined : RiseOutlined;
                                  const dirLabel = isPositive ? 'Positive' : isNegative ? 'Negative' : 'Unknown';
                                  return (
                                    <TableRow key={`${feature.feature}-${index}`} hover sx={{ bgcolor: rowSurface }}>
                                      <TableCell sx={{ color: theme.palette.common.white, fontWeight: 600 }}>
                                        {formatFeatureName(feature?.feature)}
                                      </TableCell>
                                      <TableCell
                                        sx={{ color: alpha(theme.palette.common.white, 0.85), fontVariantNumeric: 'tabular-nums' }}
                                      >
                                        {String(feature?.value ?? '—')}
                                      </TableCell>
                                      <TableCell>
                                        <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
                                          <Box sx={{ color: dirTone, display: 'flex', fontSize: '0.95rem' }}>
                                            {isPositive || isNegative ? <DirIcon /> : null}
                                          </Box>
                                          <Typography sx={{ color: dirTone, fontSize: '0.78rem', fontWeight: 700 }}>{dirLabel}</Typography>
                                        </Stack>
                                      </TableCell>
                                      <TableCell
                                        align="right"
                                        sx={{ color: theme.palette.common.white, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                                      >
                                        {formatNumber(importance * 100, 2)}%
                                      </TableCell>
                                      <TableCell sx={{ minWidth: 180 }}>
                                        <Box
                                          sx={{
                                            height: 8,
                                            borderRadius: 999,
                                            bgcolor: alpha(theme.palette.common.black, 0.3),
                                            overflow: 'hidden'
                                          }}
                                        >
                                          <Box
                                            sx={{
                                              width: `${barPct}%`,
                                              height: '100%',
                                              background: isNegative
                                                ? `linear-gradient(90deg, ${alpha(theme.palette.warning.light, 0.85)} 0%, ${theme.palette.warning.main} 100%)`
                                                : `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.75)} 0%, ${theme.palette.primary.light} 100%)`,
                                              transition: 'width 0.5s ease'
                                            }}
                                          />
                                        </Box>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })
                              ) : (
                                <TableRow sx={{ bgcolor: rowSurface }}>
                                  <TableCell colSpan={5}>
                                    <Typography
                                      variant="body2"
                                      sx={{ color: alpha(theme.palette.common.white, 0.7), fontWeight: 500, py: 1 }}
                                    >
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
                        p: { xs: 2, md: 2.5 },
                        borderRadius: 2,
                        bgcolor: alpha(theme.palette.primary.main, 0.14),
                        borderColor: alpha(theme.palette.primary.main, 0.45),
                        boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.35)}`
                      }}
                    >
                      <Stack spacing={2}>
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
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
                              fontSize: '1.1rem'
                            }}
                          >
                            <InfoCircleOutlined />
                          </Box>
                          <Stack spacing={0.1}>
                            <Typography
                              sx={{ color: theme.palette.common.white, fontWeight: 700, fontSize: '0.95rem', letterSpacing: '0.02em' }}
                            >
                              Inputs Applied To Model
                            </Typography>
                            <Typography sx={{ color: alpha(theme.palette.common.white, 0.6), fontSize: '0.76rem', fontWeight: 500 }}>
                              The exact request payload that produced this prediction
                            </Typography>
                          </Stack>
                        </Stack>
                        <Grid container spacing={1.5}>
                          <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                            <MetricCard label="Crop" value={analyzedPrediction.crop ? formatCropName(analyzedPrediction.crop) : '—'} />
                          </Grid>
                          <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                            <MetricCard label="Variety" value={analyzedPrediction.variety || '—'} />
                          </Grid>
                          <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                            <MetricCard label="Season" value={analyzedPrediction.season ?? '—'} />
                          </Grid>
                          <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                            <MetricCard label="Acres" value={formatNumber(analyzedPrediction.acres)} />
                          </Grid>
                          <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                            <MetricCard label="N (lb/ac)" value={formatNumber(analyzedPrediction.totalN)} />
                          </Grid>
                          <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                            <MetricCard label="P (lb/ac)" value={formatNumber(analyzedPrediction.totalP)} />
                          </Grid>
                          <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                            <MetricCard label="K (lb/ac)" value={formatNumber(analyzedPrediction.totalK)} />
                          </Grid>
                          <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                            <MetricCard label="Water Applied (mm)" value={formatNumber(analyzedPrediction.waterApplied)} />
                          </Grid>
                          <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                            <MetricCard label="State" value={analyzedPrediction.state || '—'} />
                          </Grid>
                          <Grid size={{ xs: 6, sm: 4, md: 3 }}>
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
             followed by the Field & Harvest Records table (with its
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

            {/* Predicted vs Observed regression diagnostic. Sits between
                the aggregate Model Performance card (the "track record"
                story) and the row-level Field Records table (the
                "evidence" story) — it's the visual bridge that shows
                how those aggregate stats are actually distributed. */}
            <ModelRegressionCard />

            {/* Field-level records table — chevron + row-click affordance
                hidden because Analytics is read-only context; the Overview
                tab keeps a chevron-enabled copy for drilling into field
                detail. The "Why predict yields on harvests?" explainer
                banner is rendered inside FieldTable, so it lands here
                automatically. `lockModelSelector` renders the model pill
                as a static chip (no dropdown) — Analyze surfaces which
                model produced the column but doesn't let the user swap
                models from this view. */}
            <FieldTable showChevron={false} lockModelSelector />
          </>
        )}
      </Stack>
    </MainCard>
  );
}
