import { useEffect, useMemo, useState } from 'react';

import { alpha, useTheme } from '@mui/material/styles';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import DownOutlined from '@ant-design/icons/DownOutlined';

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

function PredictionMetricTile({ label, value, helper }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, height: '100%' }}>
      <Stack spacing={0.35}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h5">{value}</Typography>
        {helper ? (
          <Typography variant="caption" color="text.secondary">
            {helper}
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
}

export default function PredictionReviewStep({ selectedModel, predictionResult, onOpenPredictionsTable }) {
  const theme = useTheme();
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

  useEffect(() => {
    const controller = new AbortController();

    const loadMarketMetrics = async () => {
      if (!MARKET_API_URL) {
        setMarketStatus('unconfigured');
        setMarketMessage('Set VITE_WHEAT_MARKET_API_URL to enable live market metrics.');
        return;
      }

      setMarketStatus('loading');
      setMarketMessage('');
      try {
        const response = await fetch(MARKET_API_URL, { signal: controller.signal });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Market API failed (${response.status}): ${errorText}`);
        }
        const payload = await response.json();
        const normalized = normalizeMarketPayload(payload);
        setMarketSnapshot(normalized.snapshot);
        setMarketTrend(normalized.trend);
        setMarketStatus('live');
      } catch (error) {
        if (error.name !== 'AbortError') {
          setMarketStatus('error');
          setMarketMessage(error.message || 'Live market metrics unavailable.');
          setMarketTrend(getFallbackTrend());
        }
      }
    };

    loadMarketMetrics();

    return () => controller.abort();
  }, []);

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

  return (
    <Stack spacing={2.5}>
      <Typography variant="h6">Step 3: Review Prediction</Typography>
      <Typography variant="body2" color="text.secondary">
        Review selected model, prediction values, and explainability output.
      </Typography>
      <Stack spacing={1.25}>
        <Accordion
          defaultExpanded
          disableGutters
          sx={{
            border: '1px solid',
            borderColor: accentBlue,
            background: `linear-gradient(135deg, ${alpha(theme.palette.primary.dark, 0.3)} 0%, ${alpha(theme.palette.primary.main, 0.15)} 100%)`,
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
              <Typography variant="subtitle1">Prediction Outcome</Typography>
              <Chip size="small" color="primary" label={predictionResult?.model_version || 'Unknown model'} />
            </Stack>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 2, pb: 2, pt: 0.5 }}>
            <Stack spacing={1.5}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                sx={{ justifyContent: 'space-between', alignItems: { md: 'flex-end' }, gap: 1 }}
              >
                <Box>
                  <Typography variant="h2">{predictedYield !== null ? formatNumber(predictedYield, 2) : '—'}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Predicted Yield (bu/ac)
                  </Typography>
                </Box>
                <Typography variant="body1" color="text.secondary">
                  Confidence Interval: {formatNumber(confidenceLower, 2)} - {formatNumber(confidenceUpper, 2)} bu/ac
                </Typography>
              </Stack>

              <Grid container spacing={1.5}>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <PredictionMetricTile
                    label="Lower Bound"
                    value={confidenceLower !== null ? `${formatNumber(confidenceLower, 2)} bu/ac` : '—'}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <PredictionMetricTile
                    label="Upper Bound"
                    value={confidenceUpper !== null ? `${formatNumber(confidenceUpper, 2)} bu/ac` : '—'}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <PredictionMetricTile
                    label="Confidence Width"
                    value={confidenceWidth !== null ? `${formatNumber(confidenceWidth, 2)} bu/ac` : '—'}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <PredictionMetricTile label="Prediction Run ID" value={predictionResult?.prediction_run_id ?? 'Pending'} />
                </Grid>
              </Grid>
            </Stack>
          </AccordionDetails>
        </Accordion>

        <Accordion
          defaultExpanded
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
            <Typography variant="subtitle1">Model Configuration Used</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 2, pb: 2, pt: 0.5 }}>
            <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
              <Chip label={`Version: ${selectedModel?.version_tag || 'Unknown'}`} variant="outlined" />
              <Chip label={`Type: ${selectedModel?.model_type || 'Unknown'}`} variant="outlined" />
              <Chip label={`Runtime Model: ${predictionResult?.model_version || 'Unknown'}`} variant="outlined" />
            </Stack>
          </AccordionDetails>
        </Accordion>

        <Accordion
          defaultExpanded
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
            <Typography variant="subtitle1">Top Features</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 2, pb: 2, pt: 0.5 }}>
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
                  {topFeatures.length > 0 ? (
                    topFeatures.map((feature, index) => {
                      const importance = Math.max(toNumberOrNull(feature?.importance) || 0, 0);
                      const barPct = Math.min(importance * 100, 100);
                      const direction = String(feature?.direction || '').toLowerCase();
                      const directionColor = direction === 'positive' ? 'success' : direction === 'negative' ? 'error' : 'default';
                      return (
                        <TableRow key={`${feature.feature}-${index}`} hover>
                          <TableCell>{formatFeatureName(feature?.feature)}</TableCell>
                          <TableCell>{String(feature?.value ?? '—')}</TableCell>
                          <TableCell>
                            <Chip size="small" color={directionColor} label={direction || 'unknown'} variant="outlined" />
                          </TableCell>
                          <TableCell align="right">{formatNumber(importance * 100, 2)}%</TableCell>
                          <TableCell sx={{ minWidth: 180 }}>
                            <Box sx={{ height: 8, borderRadius: 1, bgcolor: alpha(theme.palette.primary.main, 0.18), overflow: 'hidden' }}>
                              <Box sx={{ width: `${barPct}%`, height: '100%', bgcolor: theme.palette.primary.main }} />
                            </Box>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Typography variant="body2" color="text.secondary">
                          Explainability data was not returned for this prediction.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </AccordionDetails>
        </Accordion>
      </Stack>

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

      <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
        <Button variant="outlined" onClick={() => onOpenPredictionsTable?.(predictionResult?.prediction_run_id ?? null)}>
          Predictions Table
        </Button>
      </Stack>
    </Stack>
  );
}
