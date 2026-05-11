import { useEffect, useMemo, useState } from 'react';

import { alpha, useTheme } from '@mui/material/styles';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import CloseOutlined from '@ant-design/icons/CloseOutlined';
import DownOutlined from '@ant-design/icons/DownOutlined';
import FallOutlined from '@ant-design/icons/FallOutlined';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';
import RiseOutlined from '@ant-design/icons/RiseOutlined';
import ThunderboltOutlined from '@ant-design/icons/ThunderboltOutlined';

import { formatCropName } from 'utils/cropName';

// Imports below are kept for the temporarily-disabled Wheat Market Snapshot
// block further down. Re-enable them along with the JSX when wiring the
// market feed back in.
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { ReusableSalesChart } from 'sections/overview/dashboard/SalesChart';

const MARKET_API_URL = import.meta.env.VITE_WHEAT_MARKET_API_URL;
const USDA_REPORT_PLACEHOLDERS = [
  {
    key: 'wasde',
    report: 'WASDE',
    description: 'Global + U.S. wheat supply and demand balance sheets.',
    frequency: 'Monthly',
    lastPull: 'Not connected',
    status: 'planned'
  },
  {
    key: 'crop-progress',
    report: 'Crop Progress & Condition',
    description: 'State-level crop condition snapshots for wheat quality tracking.',
    frequency: 'Weekly (seasonal)',
    lastPull: 'Not connected',
    status: 'planned'
  },
  {
    key: 'usda-production',
    report: 'Small Grains Summary',
    description: 'U.S. planted/harvested acres and production summaries.',
    frequency: 'Annual',
    lastPull: 'Not connected',
    status: 'planned'
  }
];

function formatNumber(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toFixed(decimals);
}

function formatFeatureName(value) {
  if (!value) return '—';
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCurrency(value) {
  const numeric = toNumberOrNull(value);
  if (numeric === null) return '—';
  return `$${numeric.toFixed(2)}`;
}

function formatPct(value) {
  const numeric = toNumberOrNull(value);
  if (numeric === null) return '—';
  const prefix = numeric > 0 ? '+' : '';
  return `${prefix}${numeric.toFixed(2)}%`;
}

function formatVolume(value) {
  const numeric = toNumberOrNull(value);
  if (numeric === null) return '—';
  return Math.round(numeric).toLocaleString();
}

function formatAppliedText(value, decimals = 2) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return formatNumber(value, decimals);
  const numeric = toNumberOrNull(value);
  if (numeric !== null) return formatNumber(numeric, decimals);
  return String(value);
}

function getFallbackTrend() {
  return {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    series: [
      { id: 'CashPrice', label: 'Cash Price', data: [5.86, 5.81, 5.79, 5.88, 5.92, 5.9, 5.94], color: '#D9A84A' },
      { id: 'Futures', label: 'Futures', data: [5.72, 5.7, 5.68, 5.75, 5.77, 5.76, 5.8], color: '#4F8AB6' }
    ]
  };
}

function normalizeMarketPayload(payload) {
  const cashPrice = toNumberOrNull(payload?.cash_price ?? payload?.cashPrice ?? payload?.spot_price ?? payload?.spotPrice);
  const futuresPrice = toNumberOrNull(
    payload?.futures_price ?? payload?.futuresPrice ?? payload?.kc_wheat_futures ?? payload?.kcWheatFutures
  );
  const providedBasis = toNumberOrNull(payload?.basis);
  const basis = providedBasis ?? (cashPrice !== null && futuresPrice !== null ? cashPrice - futuresPrice : null);

  const changePct = toNumberOrNull(payload?.change_pct ?? payload?.changePct ?? payload?.daily_change_pct ?? payload?.dailyChangePct);
  const volume = toNumberOrNull(payload?.volume ?? payload?.open_interest ?? payload?.openInterest);
  const updatedAt = payload?.updated_at ?? payload?.updatedAt ?? null;

  const historyRows = Array.isArray(payload?.history) ? payload.history.slice(-7) : [];
  if (historyRows.length > 1) {
    const labels = historyRows.map((row, index) => row?.date ?? row?.label ?? `D${index + 1}`);
    const cashSeries = historyRows.map((row) => toNumberOrNull(row?.cash_price ?? row?.cashPrice ?? row?.spot_price ?? row?.spotPrice));
    const futuresSeries = historyRows.map((row) =>
      toNumberOrNull(row?.futures_price ?? row?.futuresPrice ?? row?.kc_wheat_futures ?? row?.kcWheatFutures)
    );
    const hasAnyNull = [...cashSeries, ...futuresSeries].some((value) => value === null);

    if (!hasAnyNull) {
      return {
        snapshot: { cashPrice, futuresPrice, basis, changePct, volume, updatedAt },
        trend: {
          labels,
          series: [
            { id: 'CashPrice', label: 'Cash Price', data: cashSeries, color: '#D9A84A' },
            { id: 'Futures', label: 'Futures', data: futuresSeries, color: '#4F8AB6' }
          ]
        }
      };
    }
  }

  return {
    snapshot: { cashPrice, futuresPrice, basis, changePct, volume, updatedAt },
    trend: getFallbackTrend()
  };
}

function MarketMetricTile({ label, value, helper }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, height: '100%' }}>
      <Stack spacing={0.5}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h6">{value}</Typography>
        {helper ? (
          <Typography variant="caption" color="text.secondary">
            {helper}
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
}

// Compact slim "STEP N" pill paired with a heading. Mirrors the upper-strip
// pattern in Overview where a primary-tinted pill anchors a section label.
function StepHeader({ step, title, subtitle }) {
  const theme = useTheme();
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
      <Box
        sx={{
          px: 1.25,
          py: 0.4,
          borderRadius: 999,
          fontSize: '0.7rem',
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: theme.palette.common.white,
          bgcolor: alpha(theme.palette.primary.main, 0.32),
          border: `1px solid ${alpha(theme.palette.primary.main, 0.55)}`,
          whiteSpace: 'nowrap'
        }}
      >
        Step {step}
      </Box>
      <Stack spacing={0.1} sx={{ minWidth: 0 }}>
        <Typography sx={{ color: theme.palette.common.white, fontWeight: 700, fontSize: '1rem', lineHeight: 1.2 }}>
          {title}
        </Typography>
        {subtitle ? (
          <Typography sx={{ color: alpha(theme.palette.common.white, 0.6), fontSize: '0.78rem', lineHeight: 1.35 }}>
            {subtitle}
          </Typography>
        ) : null}
      </Stack>
    </Stack>
  );
}

// Horizontal range bar that shows the 95% CI as a span, with a glowing
// marker at the predicted value. End-labels expose the bound numbers so
// the user reads min/center/max without parsing the headline number first.
function ConfidenceRangeBar({ lower, upper, predicted }) {
  const theme = useTheme();
  const isValid = lower !== null && upper !== null && predicted !== null && upper > lower;
  // Raw position can be <0 or >100 when the model is inconsistent (e.g.
  // CatBoost quantile crossing where q0.5 lands outside [q0.05, q0.95]).
  // We clamp for display so the dot stays on the track, and surface the
  // anomaly via marker color + a tooltip rather than letting the dot
  // silently fly off the bar.
  const rawPct = isValid ? ((predicted - lower) / (upper - lower)) * 100 : 50;
  const markerPct = Math.max(0, Math.min(100, rawPct));
  const isOutOfRange = isValid && (rawPct < 0 || rawPct > 100);
  const markerBorder = isOutOfRange ? theme.palette.warning.main : theme.palette.primary.main;
  const markerHalo = isOutOfRange
    ? `0 0 0 4px ${alpha(theme.palette.warning.main, 0.28)}, 0 0 12px ${alpha(theme.palette.warning.main, 0.55)}`
    : `0 0 0 4px ${alpha(theme.palette.primary.main, 0.28)}, 0 0 12px ${alpha(theme.palette.primary.main, 0.45)}`;

  const marker = (
    <Box
      sx={{
        position: 'absolute',
        top: '50%',
        left: `${markerPct}%`,
        transform: 'translate(-50%, -50%)',
        width: 18,
        height: 18,
        borderRadius: '50%',
        bgcolor: theme.palette.common.white,
        border: `2px solid ${markerBorder}`,
        boxShadow: markerHalo,
        cursor: isOutOfRange ? 'help' : 'default'
      }}
    />
  );

  return (
    <Stack spacing={1.25}>
      <Box sx={{ position: 'relative', height: 36 }}>
        {/* Track */}
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: 0,
            right: 0,
            transform: 'translateY(-50%)',
            height: 10,
            borderRadius: 999,
            background: `linear-gradient(90deg,
              ${alpha(theme.palette.warning.main, 0.55)} 0%,
              ${alpha(theme.palette.primary.main, 0.85)} 50%,
              ${alpha(theme.palette.success.main, 0.55)} 100%)`,
            border: `1px solid ${alpha(theme.palette.primary.main, 0.55)}`,
            boxShadow: `inset 0 0 8px ${alpha(theme.palette.common.black, 0.35)}`
          }}
        />
        {/* End caps */}
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: 0,
            transform: 'translate(-50%, -50%)',
            width: 4,
            height: 18,
            borderRadius: 1,
            bgcolor: alpha(theme.palette.warning.light, 0.95)
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            right: 0,
            transform: 'translate(50%, -50%)',
            width: 4,
            height: 18,
            borderRadius: 1,
            bgcolor: alpha(theme.palette.success.light, 0.95)
          }}
        />
        {/* Predicted marker. Clamped to the track; warning-tinted when the
            model's predicted value falls outside its own CI (quantile
            crossing, etc.) so the inconsistency is visible at a glance. */}
        {isValid ? (
          isOutOfRange ? (
            <Tooltip
              arrow
              placement="top"
              title={`This model returned a predicted value (${formatNumber(predicted, 2)}) that falls outside its own confidence interval. The dot is pinned to the nearest bound so it stays on the bar. This typically indicates quantile crossing in a tree-based quantile model.`}
              slotProps={{
                tooltip: {
                  sx: {
                    bgcolor: `color-mix(in srgb, ${theme.palette.warning.main} 22%, ${theme.palette.background.paper})`,
                    color: theme.palette.common.white,
                    border: `1px solid ${alpha(theme.palette.warning.main, 0.55)}`,
                    fontSize: '0.74rem',
                    fontWeight: 500,
                    maxWidth: 280,
                    px: 1.25,
                    py: 0.85
                  }
                },
                arrow: {
                  sx: { color: `color-mix(in srgb, ${theme.palette.warning.main} 22%, ${theme.palette.background.paper})` }
                }
              }}
            >
              {marker}
            </Tooltip>
          ) : (
            marker
          )
        ) : null}
      </Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Stack spacing={0.1} sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              color: alpha(theme.palette.warning.light, 0.95),
              fontWeight: 700,
              fontSize: '0.62rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase'
            }}
          >
            Lower bound
          </Typography>
          <Typography
            sx={{
              color: theme.palette.common.white,
              fontWeight: 700,
              fontSize: '0.95rem',
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {lower !== null ? formatNumber(lower, 2) : '—'}
          </Typography>
        </Stack>
        <Stack spacing={0.1} sx={{ textAlign: 'center' }}>
          <Typography
            sx={{
              color: alpha(theme.palette.primary.light, 0.95),
              fontWeight: 700,
              fontSize: '0.62rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase'
            }}
          >
            Predicted
          </Typography>
          <Typography
            sx={{
              color: theme.palette.common.white,
              fontWeight: 700,
              fontSize: '0.95rem',
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {predicted !== null ? formatNumber(predicted, 2) : '—'}
          </Typography>
        </Stack>
        <Stack spacing={0.1} sx={{ textAlign: 'right' }}>
          <Typography
            sx={{
              color: alpha(theme.palette.success.light, 0.95),
              fontWeight: 700,
              fontSize: '0.62rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase'
            }}
          >
            Upper bound
          </Typography>
          <Typography
            sx={{
              color: theme.palette.common.white,
              fontWeight: 700,
              fontSize: '0.95rem',
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {upper !== null ? formatNumber(upper, 2) : '—'}
          </Typography>
        </Stack>
      </Stack>
    </Stack>
  );
}

// Small metric tile used in the hero card footer + inputs grid. Tinted
// surface + tabular numerals follow Overview's MetricTile pattern.
function MetricTile({ label, value, helper }) {
  const theme = useTheme();
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.75,
        height: '100%',
        borderRadius: 1.5,
        bgcolor: alpha(theme.palette.primary.main, 0.12),
        borderColor: alpha(theme.palette.primary.main, 0.4),
        boxShadow: `0 2px 8px ${alpha(theme.palette.common.black, 0.25)}`
      }}
    >
      <Stack spacing={0.55}>
        <Typography
          sx={{
            color: alpha(theme.palette.primary.light, 0.95),
            fontWeight: 700,
            fontSize: '0.66rem',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            lineHeight: 1.2
          }}
        >
          {label}
        </Typography>
        <Typography
          sx={{
            color: theme.palette.common.white,
            fontWeight: 700,
            fontSize: '1.05rem',
            lineHeight: 1.25,
            fontVariantNumeric: 'tabular-nums',
            wordBreak: 'break-word'
          }}
        >
          {value}
        </Typography>
        {helper ? (
          <Typography
            sx={{
              color: alpha(theme.palette.common.white, 0.55),
              fontSize: '0.7rem',
              fontWeight: 500,
              lineHeight: 1.35
            }}
          >
            {helper}
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
}

// Ranked feature row. Replaces the SHAP table with a richer per-row
// layout: a tone-colored rank chip on the left, feature identity in the
// middle, importance + direction on the right, and a full-width
// importance bar below so the visual weight of each contribution is
// immediately legible at a glance.
function FeatureRow({ rank, feature, value, importance, direction, isLast }) {
  const theme = useTheme();
  const importancePct = Math.min(Math.max(importance * 100, 0), 100);
  const directionKey = String(direction || '').toLowerCase();
  const directionTone =
    directionKey === 'positive'
      ? theme.palette.success.light
      : directionKey === 'negative'
        ? theme.palette.warning.light
        : alpha(theme.palette.common.white, 0.55);
  const DirectionIcon = directionKey === 'negative' ? FallOutlined : RiseOutlined;
  // Top-3 ranks get progressively brighter primary shades, matching
  // Overview's TopCropsBreakdown ranking palette.
  const rankPalette = [
    theme.palette.primary.main,
    theme.palette.primary.light,
    alpha(theme.palette.primary.light, 0.6)
  ];
  const rankColor = rankPalette[Math.min(rank - 1, rankPalette.length - 1)] || alpha(theme.palette.primary.light, 0.4);

  return (
    <Box
      sx={{
        pb: isLast ? 0 : 1.25,
        mb: isLast ? 0 : 1.25,
        borderBottom: isLast ? 'none' : `1px solid ${alpha(theme.palette.primary.main, 0.15)}`
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 0.75 }}>
        <Box
          sx={{
            width: 26,
            height: 26,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: alpha(rankColor, 0.2),
            border: `1.5px solid ${rankColor}`,
            color: theme.palette.common.white,
            fontWeight: 700,
            fontSize: '0.75rem',
            fontVariantNumeric: 'tabular-nums',
            flexShrink: 0
          }}
        >
          {rank}
        </Box>
        <Stack spacing={0.1} sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{
              color: theme.palette.common.white,
              fontWeight: 700,
              fontSize: '0.88rem',
              lineHeight: 1.25,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {formatFeatureName(feature)}
          </Typography>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
            <Typography
              sx={{
                color: alpha(theme.palette.common.white, 0.55),
                fontSize: '0.7rem',
                fontWeight: 600,
                letterSpacing: '0.02em'
              }}
            >
              Value:
            </Typography>
            <Typography
              sx={{
                color: alpha(theme.palette.common.white, 0.85),
                fontSize: '0.72rem',
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums'
              }}
            >
              {value === null || value === undefined ? '—' : String(value)}
            </Typography>
          </Stack>
        </Stack>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexShrink: 0 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: directionTone,
              fontSize: '0.95rem'
            }}
          >
            <DirectionIcon />
          </Box>
          <Stack spacing={0} sx={{ alignItems: 'flex-end' }}>
            <Typography
              sx={{
                color: theme.palette.common.white,
                fontWeight: 700,
                fontSize: '1rem',
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1.1
              }}
            >
              {formatNumber(importancePct, 1)}%
            </Typography>
            <Typography
              sx={{
                color: alpha(theme.palette.common.white, 0.5),
                fontSize: '0.6rem',
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase'
              }}
            >
              Impact
            </Typography>
          </Stack>
        </Stack>
      </Stack>
      <Box
        sx={{
          height: 6,
          borderRadius: 999,
          bgcolor: alpha(theme.palette.common.black, 0.3),
          overflow: 'hidden',
          ml: 4.25
        }}
      >
        <Box
          sx={{
            height: '100%',
            width: `${importancePct}%`,
            background:
              directionKey === 'negative'
                ? `linear-gradient(90deg, ${alpha(theme.palette.warning.light, 0.85)} 0%, ${theme.palette.warning.main} 100%)`
                : `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.75)} 0%, ${theme.palette.primary.light} 100%)`,
            transition: 'width 0.5s ease'
          }}
        />
      </Box>
    </Box>
  );
}

// Section-titled tile group. Used inside the InputsAppliedBanner to
// group the 12 applied-input values into Field / Location / Nutrients
// clusters so the eye doesn't have to scan a flat 12-tile wall.
function InputGroup({ label, children }) {
  const theme = useTheme();
  return (
    <Stack spacing={1}>
      <Typography
        sx={{
          color: alpha(theme.palette.primary.light, 0.95),
          fontWeight: 700,
          fontSize: '0.7rem',
          letterSpacing: '0.14em',
          textTransform: 'uppercase'
        }}
      >
        {label}
      </Typography>
      <Grid container spacing={1.25}>
        {children}
      </Grid>
    </Stack>
  );
}

// Collapsible banner mirroring OverviewTableBanner. Default-open so
// reviewers see the inputs immediately, but can be collapsed when the
// reviewer wants to focus on the prediction itself.
function InputsAppliedBanner({ appliedInputs }) {
  const theme = useTheme();
  const [open, setOpen] = useState(true);

  const fieldTiles = [
    { label: 'Crop', value: formatCropName(String(appliedInputs.crop)) },
    { label: 'Variety', value: String(appliedInputs.variety) },
    { label: 'Season', value: String(appliedInputs.season) },
    { label: 'Acres', value: formatAppliedText(appliedInputs.acres) }
  ];
  const locationTiles = [
    { label: 'State', value: String(appliedInputs.state) },
    { label: 'County', value: String(appliedInputs.county) }
  ];
  const nutrientTiles = [
    { label: 'N (lb/ac)', value: formatAppliedText(appliedInputs.totalN) },
    { label: 'P (lb/ac)', value: formatAppliedText(appliedInputs.totalP) },
    { label: 'K (lb/ac)', value: formatAppliedText(appliedInputs.totalK) },
    { label: 'Water (mm)', value: formatAppliedText(appliedInputs.waterApplied) }
  ];

  return (
    <Paper
      variant="outlined"
      sx={{
        bgcolor: alpha(theme.palette.primary.main, 0.14),
        borderColor: alpha(theme.palette.primary.main, 0.45),
        borderRadius: 2,
        backgroundImage: 'none',
        overflow: 'hidden',
        boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.35)}`
      }}
    >
      <Stack
        direction="row"
        spacing={1.5}
        sx={{
          alignItems: 'center',
          px: 2.25,
          py: 1.5,
          cursor: 'pointer',
          '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.08) }
        }}
        onClick={() => setOpen((prev) => !prev)}
        role="button"
        aria-expanded={open}
        aria-label="Toggle applied inputs"
      >
        <Box
          sx={{
            color: alpha(theme.palette.primary.light, 0.95),
            fontSize: '1.05rem',
            display: 'flex',
            alignItems: 'center'
          }}
        >
          <InfoCircleOutlined />
        </Box>
        <Typography
          sx={{
            flex: 1,
            fontWeight: 700,
            color: theme.palette.common.white,
            fontSize: '0.92rem',
            letterSpacing: '0.01em'
          }}
        >
          Inputs applied to model
        </Typography>
        <Typography
          sx={{
            color: alpha(theme.palette.common.white, 0.5),
            fontSize: '0.72rem',
            fontWeight: 500,
            display: { xs: 'none', sm: 'block' },
            mr: 0.5
          }}
        >
          10 fields
        </Typography>
        <IconButton
          size="small"
          aria-label={open ? 'Collapse inputs' : 'Expand inputs'}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((prev) => !prev);
          }}
          sx={{
            color: alpha(theme.palette.common.white, 0.7),
            '&:hover': {
              color: theme.palette.common.white,
              bgcolor: alpha(theme.palette.primary.main, 0.18)
            }
          }}
        >
          {open ? <CloseOutlined style={{ fontSize: '0.85rem' }} /> : <DownOutlined style={{ fontSize: '0.85rem' }} />}
        </IconButton>
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 2.25, pb: 2.25, pt: 0.5 }}>
          <Stack spacing={2}>
            <InputGroup label="Field & Crop">
              {fieldTiles.map((tile) => (
                <Grid key={tile.label} size={{ xs: 6, sm: 4, md: 3 }}>
                  <MetricTile label={tile.label} value={tile.value} />
                </Grid>
              ))}
            </InputGroup>
            <InputGroup label="Location">
              {locationTiles.map((tile) => (
                <Grid key={tile.label} size={{ xs: 6, sm: 4, md: 3 }}>
                  <MetricTile label={tile.label} value={tile.value} />
                </Grid>
              ))}
            </InputGroup>
            <InputGroup label="Nutrients & Water">
              {nutrientTiles.map((tile) => (
                <Grid key={tile.label} size={{ xs: 6, sm: 4, md: 3 }}>
                  <MetricTile label={tile.label} value={tile.value} />
                </Grid>
              ))}
            </InputGroup>
          </Stack>
        </Box>
      </Collapse>
    </Paper>
  );
}

export default function PredictionReviewStep({ selectedModel, predictionResult, requestPayload, onOpenPredictionsTable }) {
  const theme = useTheme();
  // Kept for re-enabling the Wheat Market Snapshot section below.
  const accentBlue = alpha(theme.palette.primary.main, 0.45);
  const headerBlue = `color-mix(in srgb, ${theme.palette.primary.main} 45%, ${theme.palette.background.paper})`;
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
  const [marketSnapshot, setMarketSnapshot] = useState({
    cashPrice: null,
    futuresPrice: null,
    basis: null,
    changePct: null,
    volume: null,
    updatedAt: null
  });
  const [marketTrend, setMarketTrend] = useState(getFallbackTrend());
  const [marketStatus, setMarketStatus] = useState('idle');
  const [marketMessage, setMarketMessage] = useState('');

  // Wheat Market Snapshot temporarily disabled — re-enable when the market feed is ready.
  // useEffect(() => {
  //   const controller = new AbortController();
  //
  //   const loadMarketMetrics = async () => {
  //     if (!MARKET_API_URL) {
  //       setMarketStatus('unconfigured');
  //       setMarketMessage('Set VITE_WHEAT_MARKET_API_URL to enable live market metrics.');
  //       return;
  //     }
  //
  //     setMarketStatus('loading');
  //     setMarketMessage('');
  //     try {
  //       const response = await fetch(MARKET_API_URL, { signal: controller.signal });
  //       if (!response.ok) {
  //         const errorText = await response.text();
  //         throw new Error(`Market API failed (${response.status}): ${errorText}`);
  //       }
  //       const payload = await response.json();
  //       const normalized = normalizeMarketPayload(payload);
  //       setMarketSnapshot(normalized.snapshot);
  //       setMarketTrend(normalized.trend);
  //       setMarketStatus('live');
  //     } catch (error) {
  //       if (error.name !== 'AbortError') {
  //         setMarketStatus('error');
  //         setMarketMessage(error.message || 'Live market metrics unavailable.');
  //         setMarketTrend(getFallbackTrend());
  //       }
  //     }
  //   };
  //
  //   loadMarketMetrics();
  //
  //   return () => controller.abort();
  // }, []);

  const chartHeadline = useMemo(() => {
    if (marketSnapshot.futuresPrice === null) return 'Awaiting live feed';
    return `${formatCurrency(marketSnapshot.futuresPrice)}/bu`;
  }, [marketSnapshot.futuresPrice]);

  const statusChip = useMemo(() => {
    if (marketStatus === 'live') return { label: 'Live Feed', color: 'success' };
    if (marketStatus === 'loading') return { label: 'Loading', color: 'warning' };
    if (marketStatus === 'unconfigured') return { label: 'API Not Configured', color: 'default' };
    if (marketStatus === 'error') return { label: 'Feed Unavailable', color: 'error' };
    return { label: 'Market Snapshot', color: 'default' };
  }, [marketStatus]);

  const topFeatures = predictionResult?.explainability?.top_features || [];
  const predictedYield = toNumberOrNull(predictionResult?.predicted_yield);
  const confidenceLower = toNumberOrNull(predictionResult?.confidence_interval?.[0]);
  const confidenceUpper = toNumberOrNull(predictionResult?.confidence_interval?.[1]);
  const confidenceWidth = confidenceLower !== null && confidenceUpper !== null ? Math.max(confidenceUpper - confidenceLower, 0) : null;
  // Coverage fraction returned by the backend (e.g. 0.95 for a Gaussian
  // 1.96·σ interval, 0.90 for a CatBoost q=0.05/q=0.95 ensemble). Renders
  // as a percentage label so we stop stamping "95%" on intervals that
  // may be 90% or wider. Older payloads without the field render the
  // generic "Confidence interval" label.
  const confidenceLevel = toNumberOrNull(predictionResult?.confidence_level);
  const confidenceLabel = confidenceLevel !== null
    ? `${Math.round(confidenceLevel * 100)}% confidence interval`
    : 'Confidence interval';
  const appliedInputs = useMemo(() => {
    const source = requestPayload || predictionResult?.request_payload || {};
    return {
      crop: source.crop || '—',
      variety: source.variety || '—',
      season: source.season ?? '—',
      state: source.state || '—',
      county: source.county || '—',
      acres: source.acres,
      totalN: source.totalN_per_ac,
      totalP: source.totalP_per_ac,
      totalK: source.totalK_per_ac,
      waterApplied: source.water_applied_mm
    };
  }, [predictionResult, requestPayload]);

  const runtimeModelVersion = predictionResult?.model_version || 'Unknown';
  const runId = predictionResult?.prediction_run_id ?? null;

  return (
    <Stack spacing={2.5}>
      <StepHeader step={3} title="Review Prediction" subtitle="Model output, explainability, and inputs applied." />

      {/* HERO: predicted yield, confidence range, and model metadata. Same
          radial-gradient surface treatment as Overview's hero card so this
          section reads as the headline result, not just another panel. */}
      <Paper
        variant="outlined"
        sx={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 2,
          borderColor: alpha(theme.palette.primary.main, 0.45),
          backgroundImage: `radial-gradient(120% 120% at 0% 0%, ${alpha(theme.palette.primary.main, 0.32)} 0%, transparent 55%),
            radial-gradient(120% 120% at 100% 100%, ${alpha(theme.palette.primary.main, 0.16)} 0%, transparent 60%),
            linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.22)} 0%, ${alpha(theme.palette.primary.main, 0.05)} 55%, ${alpha(theme.palette.background.paper, 0.55)} 100%)`,
          boxShadow: `0 6px 20px ${alpha(theme.palette.common.black, 0.4)}`
        }}
      >
        {/* Metadata strip: pulsing dot + status, model version + run id */}
        <Box
          sx={{
            px: { xs: 2, md: 2.75 },
            py: 1.25,
            borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
            bgcolor: alpha(theme.palette.primary.main, 0.12)
          }}
        >
          <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Box
                aria-hidden
                sx={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  bgcolor: theme.palette.success.main,
                  boxShadow: `0 0 0 0 ${alpha(theme.palette.success.main, 0.55)}`,
                  animation: 'predictionPulse 2.4s ease-in-out infinite',
                  '@keyframes predictionPulse': {
                    '0%, 100%': { boxShadow: `0 0 0 0 ${alpha(theme.palette.success.main, 0.55)}` },
                    '50%': { boxShadow: `0 0 0 6px ${alpha(theme.palette.success.main, 0)}` }
                  }
                }}
              />
              <Typography
                sx={{
                  color: alpha(theme.palette.common.white, 0.6),
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase'
                }}
              >
                Prediction Complete
              </Typography>
            </Stack>
            <Box sx={{ flex: 1, minWidth: 0 }} />
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Box
                sx={{
                  px: 1,
                  py: 0.35,
                  borderRadius: 999,
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  color: theme.palette.common.white,
                  bgcolor: alpha(theme.palette.primary.main, 0.28),
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.55)}`,
                  whiteSpace: 'nowrap'
                }}
              >
                Model · {runtimeModelVersion}
              </Box>
              <Box
                sx={{
                  px: 1,
                  py: 0.35,
                  borderRadius: 999,
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  color: alpha(theme.palette.common.white, 0.78),
                  bgcolor: alpha(theme.palette.common.black, 0.25),
                  border: `1px solid ${alpha(theme.palette.common.white, 0.15)}`,
                  whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums'
                }}
              >
                Run · {runId ?? 'Pending'}
              </Box>
            </Stack>
          </Stack>
        </Box>

        <Box sx={{ p: { xs: 2.5, md: 3 } }}>
          <Grid container spacing={{ xs: 2.5, md: 4 }} sx={{ alignItems: 'center' }}>
            <Grid size={{ xs: 12, md: 5 }}>
              <Stack spacing={1}>
                <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
                  <Typography
                    sx={{
                      color: alpha(theme.palette.primary.light, 0.95),
                      fontWeight: 700,
                      fontSize: '0.78rem',
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase'
                    }}
                  >
                    Predicted Yield
                  </Typography>
                  <Tooltip
                    arrow
                    placement="top"
                    title={
                      <Box sx={{ p: 0.25 }}>
                        <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5, color: 'inherit' }}>
                          About this prediction
                        </Typography>
                        <Typography sx={{ fontSize: '0.74rem', lineHeight: 1.5, color: 'inherit', mb: 0.75 }}>
                          The yield value is the model's point estimate (typically its median quantile or
                          mean output) for this exact set of inputs, expressed in bushels per acre.
                        </Typography>
                        <Typography sx={{ fontSize: '0.74rem', lineHeight: 1.5, color: 'inherit', mb: 0.75 }}>
                          <Box component="span" sx={{ fontWeight: 700 }}>{confidenceLabel}</Box>{' '}
                          — the range the model believes contains the true yield with
                          {confidenceLevel !== null ? ` ~${Math.round(confidenceLevel * 100)}%` : ' high'} probability.
                          The coverage level above is reported live by the model: for tree-based quantile ensembles
                          it's the span of the trained quantiles (e.g. q=0.05 to q=0.95 → 90%), and for DL models
                          with an uncertainty head it's <Box component="span" sx={{ fontStyle: 'italic' }}>mean ± 1.96·σ</Box>{' '}
                          (~95%). Narrower bounds mean the model is more confident about this specific input.
                        </Typography>
                        <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.45, color: 'inherit', opacity: 0.85 }}>
                          A warning-tinted dot on the range bar means the prediction fell outside its own CI
                          — usually a sign of quantile crossing in tree-based quantile models.
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
                          maxWidth: 360,
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
                      aria-label="About the prediction and confidence interval"
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'help',
                        color: alpha(theme.palette.primary.light, 0.7),
                        transition: 'color 0.15s ease',
                        fontSize: '0.85rem',
                        '&:hover, &:focus-visible': { color: theme.palette.primary.light, outline: 'none' }
                      }}
                    >
                      <InfoCircleOutlined />
                    </Box>
                  </Tooltip>
                </Stack>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap', rowGap: 0.25 }}>
                  <Typography
                    sx={{
                      color: theme.palette.common.white,
                      fontWeight: 700,
                      fontSize: { xs: '2.6rem', md: '3rem' },
                      lineHeight: 1.05,
                      fontVariantNumeric: 'tabular-nums'
                    }}
                  >
                    {predictedYield !== null ? formatNumber(predictedYield, 2) : '—'}
                  </Typography>
                  <Typography
                    sx={{
                      color: alpha(theme.palette.common.white, 0.6),
                      fontWeight: 500,
                      fontSize: '1.05rem'
                    }}
                  >
                    bu/ac
                  </Typography>
                </Stack>
                <Typography
                  sx={{
                    color: alpha(theme.palette.common.white, 0.65),
                    fontSize: '0.78rem',
                    fontWeight: 500,
                    lineHeight: 1.4
                  }}
                >
                  {confidenceWidth !== null
                    ? `${confidenceLabel} · ±${formatNumber(confidenceWidth / 2, 2)} bu/ac`
                    : 'Confidence interval not available'}
                </Typography>
              </Stack>
            </Grid>
            <Grid size={{ xs: 12, md: 7 }}>
              <ConfidenceRangeBar lower={confidenceLower} upper={confidenceUpper} predicted={predictedYield} />
            </Grid>
          </Grid>
        </Box>

        {/* Footer strip with model configuration chips so the user can verify
            the exact runtime in the same card as the prediction. */}
        <Box
          sx={{
            px: { xs: 2, md: 2.75 },
            py: 1.25,
            borderTop: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
            bgcolor: alpha(theme.palette.common.black, 0.18)
          }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.75 }}>
            <Typography
              sx={{
                color: alpha(theme.palette.common.white, 0.55),
                fontSize: '0.68rem',
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase'
              }}
            >
              Configuration
            </Typography>
            <Box
              sx={{
                px: 0.95,
                py: 0.3,
                borderRadius: 999,
                fontSize: '0.72rem',
                fontWeight: 600,
                color: alpha(theme.palette.common.white, 0.82),
                border: `1px solid ${alpha(theme.palette.primary.main, 0.4)}`,
                whiteSpace: 'nowrap'
              }}
            >
              Version: {selectedModel?.version_tag || 'Unknown'}
            </Box>
            <Box
              sx={{
                px: 0.95,
                py: 0.3,
                borderRadius: 999,
                fontSize: '0.72rem',
                fontWeight: 600,
                color: alpha(theme.palette.common.white, 0.82),
                border: `1px solid ${alpha(theme.palette.primary.main, 0.4)}`,
                whiteSpace: 'nowrap'
              }}
            >
              Type: {selectedModel?.model_type || 'Unknown'}
            </Box>
            <Box
              sx={{
                px: 0.95,
                py: 0.3,
                borderRadius: 999,
                fontSize: '0.72rem',
                fontWeight: 600,
                color: alpha(theme.palette.common.white, 0.82),
                border: `1px solid ${alpha(theme.palette.primary.main, 0.4)}`,
                whiteSpace: 'nowrap'
              }}
            >
              Runtime: {runtimeModelVersion}
            </Box>
          </Stack>
        </Box>
      </Paper>

      {/* TOP FEATURES: ranked rows replacing the previous wide table. */}
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2, md: 2.5 },
          borderRadius: 2,
          bgcolor: alpha(theme.palette.primary.main, 0.14),
          borderColor: alpha(theme.palette.primary.main, 0.4),
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
                sx={{
                  color: theme.palette.common.white,
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  letterSpacing: '0.02em'
                }}
              >
                Top Contributing Features
              </Typography>
              <Typography
                sx={{
                  color: alpha(theme.palette.common.white, 0.6),
                  fontSize: '0.76rem',
                  fontWeight: 500
                }}
              >
                Ranked by SHAP impact{topFeatures.length > 0 ? ` · ${topFeatures.length} feature${topFeatures.length === 1 ? '' : 's'}` : ''}
              </Typography>
            </Stack>
            <Tooltip
              arrow
              placement="left"
              title="Each feature's importance is the share of total |SHAP| value, normalized so the top features sum to 1.0. Direction shows whether the feature pushed the prediction up (positive) or down (negative) for this specific row."
              slotProps={{
                tooltip: {
                  sx: {
                    bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})`,
                    color: theme.palette.common.white,
                    border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    maxWidth: 280,
                    px: 1.25,
                    py: 0.85
                  }
                },
                arrow: {
                  sx: {
                    color: `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})`
                  }
                }
              }}
            >
              <Box
                tabIndex={0}
                aria-label="About this section"
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

          {topFeatures.length > 0 ? (
            <Box>
              {topFeatures.map((feature, index) => (
                <FeatureRow
                  key={`${feature.feature}-${index}`}
                  rank={index + 1}
                  feature={feature?.feature}
                  value={feature?.value}
                  importance={Math.max(toNumberOrNull(feature?.importance) || 0, 0)}
                  direction={feature?.direction}
                  isLast={index === topFeatures.length - 1}
                />
              ))}
            </Box>
          ) : (
            <Box
              sx={{
                p: 2.5,
                borderRadius: 1.5,
                border: `1px dashed ${alpha(theme.palette.primary.main, 0.45)}`,
                bgcolor: alpha(theme.palette.common.black, 0.2),
                textAlign: 'center'
              }}
            >
              <Typography
                sx={{
                  color: alpha(theme.palette.common.white, 0.7),
                  fontSize: '0.82rem',
                  fontWeight: 500,
                  lineHeight: 1.5
                }}
              >
                Explainability data was not returned for this prediction.
              </Typography>
              <Typography
                sx={{
                  color: alpha(theme.palette.common.white, 0.45),
                  fontSize: '0.72rem',
                  fontWeight: 500,
                  lineHeight: 1.5,
                  mt: 0.75
                }}
              >
                Check the backend logs for the explainability traceback.
              </Typography>
            </Box>
          )}
        </Stack>
      </Paper>

      <InputsAppliedBanner appliedInputs={appliedInputs} />

      {/* Wheat Market Snapshot temporarily disabled — re-enable when the market feed is ready.
      <Divider />

      <Accordion
        disableGutters
        sx={{
          border: '1px solid',
          borderColor: accentBlue,
          '&::before': { display: 'none' }
        }}
      >
        <AccordionSummary
          expandIcon={<DownOutlined style={{ color: '#e0e0e0' }} />}
          sx={{
            px: 2,
            '& .MuiAccordionSummary-content': { my: 1 },
            '& .MuiAccordionSummary-expandIconWrapper': {
              ml: 1.5
            }
          }}
        >
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <Typography variant="subtitle1">Wheat Market Snapshot</Typography>
            <Chip label={statusChip.label} color={statusChip.color} size="small" />
          </Stack>
        </AccordionSummary>
        <AccordionDetails sx={{ px: 2, pb: 2, pt: 0.5 }}>
          <Stack spacing={2}>
            {marketMessage ? (
              <Alert severity={marketStatus === 'error' ? 'warning' : 'info'} sx={{ py: 0 }}>
                {marketMessage}
              </Alert>
            ) : null}

            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <MarketMetricTile label="Cash Wheat" value={`${formatCurrency(marketSnapshot.cashPrice)}/bu`} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <MarketMetricTile label="KC Wheat Futures" value={`${formatCurrency(marketSnapshot.futuresPrice)}/bu`} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <MarketMetricTile
                  label="Basis"
                  value={marketSnapshot.basis === null ? '—' : `${formatNumber(marketSnapshot.basis, 2)} $/bu`}
                  helper="Cash - futures"
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <MarketMetricTile
                  label="Daily Change / Volume"
                  value={formatPct(marketSnapshot.changePct)}
                  helper={`Vol: ${formatVolume(marketSnapshot.volume)}`}
                />
              </Grid>
            </Grid>

            <ReusableSalesChart
              title="Wheat Cash vs Futures Trend"
              headline={chartHeadline}
              subtitle={marketSnapshot.updatedAt ? `Updated: ${String(marketSnapshot.updatedAt)}` : 'Using latest available trend data'}
              labels={marketTrend.labels}
              series={marketTrend.series}
              valueFormatter={(value) => `$${formatNumber(value, 2)}/bu`}
              height={290}
            />

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={1.25}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="subtitle1">USDA Reports Feed (Placeholder)</Typography>
                  <Chip size="small" label="Planned Integration" />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  Reserve this section for upcoming USDA report pulls so users can inspect high-impact wheat reports next to prediction
                  outputs.
                </Typography>
                <TableContainer sx={{ border: 1, borderColor: accentBlue, borderRadius: 1, ...tableScrollbarSx }}>
                  <Table size="small" sx={{ minWidth: 760 }}>
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
                        <TableCell>Report</TableCell>
                        <TableCell>Description</TableCell>
                        <TableCell>Frequency</TableCell>
                        <TableCell>Last Pull</TableCell>
                        <TableCell>Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {USDA_REPORT_PLACEHOLDERS.map((row) => (
                        <TableRow key={row.key} hover>
                          <TableCell>{row.report}</TableCell>
                          <TableCell>{row.description}</TableCell>
                          <TableCell>{row.frequency}</TableCell>
                          <TableCell>{row.lastPull}</TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={row.status === 'planned' ? 'Planned' : 'Connected'}
                              color="default"
                              variant="outlined"
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Stack>
            </Paper>
          </Stack>
        </AccordionDetails>
      </Accordion>
      */}

      <Stack direction="row" sx={{ justifyContent: 'flex-end', pt: 0.25 }}>
        <Button
          variant="outlined"
          onClick={() => onOpenPredictionsTable?.(predictionResult?.prediction_run_id ?? null)}
          sx={{
            textTransform: 'none',
            fontWeight: 700,
            fontSize: '0.82rem',
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
            }
          }}
        >
          Open Predictions Table
        </Button>
      </Stack>
    </Stack>
  );
}
