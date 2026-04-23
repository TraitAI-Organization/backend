import { useEffect, useMemo, useState } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
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
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';
import { BarChart } from '@mui/x-charts';

import MainCard from 'components/MainCard';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');
const NUTRIENT_CATEGORIES = ['N (lb/ac)', 'P (lb/ac)', 'K (lb/ac)'];
const YIELD_CATEGORIES = ['Lower CI', 'Predicted', 'Upper CI', 'Regional Avg'];

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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

function MetricCard({ label, value, helper }) {
  const theme = useTheme();
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        height: '100%',
        bgcolor: alpha(theme.palette.grey[500], 0.12),
        borderColor: alpha(theme.palette.grey[400], 0.45)
      }}
    >
      <Stack spacing={0.75}>
        <Typography
          variant="body2"
          sx={{
            color: alpha(theme.palette.primary.light, 0.92),
            fontWeight: 600,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
            textShadow: `0 0 10px ${alpha(theme.palette.primary.main, 0.28)}`
          }}
        >
          {label}
        </Typography>
        <Typography
          variant="h6"
          sx={{
            color: theme.palette.common.white,
            fontWeight: 700,
            lineHeight: 1.2
          }}
        >
          {value}
        </Typography>
        {helper ? (
          <Typography
            variant="caption"
            sx={{
              color: alpha(theme.palette.grey[300], 0.92),
              fontWeight: 500
            }}
          >
            {helper}
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
}

export default function Analytics({ preselectedPredictionRunId = null }) {
  const theme = useTheme();
  const accentBlue = alpha(theme.palette.primary.main, 0.45);
  const headerBlue = `color-mix(in srgb, ${theme.palette.primary.main} 45%, ${theme.palette.background.paper})`;
  const rowSurface = alpha(theme.palette.grey[500], 0.12);
  const graphCardSurface = alpha(theme.palette.grey[500], 0.12);
  const graphCardHeaderSurface = alpha(theme.palette.grey[500], 0.16);
  const graphCardBorder = alpha(theme.palette.grey[400], 0.45);
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

  return (
    <MainCard title="Prediction Analytics">
      <Stack spacing={2.5}>
        <Typography variant="body1" color="text.primary">
          Select a saved prediction from the table, then run analysis using the exact values used for that prediction.
        </Typography>

        {loadError ? <Alert severity="error">{loadError}</Alert> : null}

        <Paper
          variant="outlined"
          sx={{
            bgcolor: graphCardSurface,
            borderColor: graphCardBorder
          }}
        >
          {isLoading ? <LinearProgress /> : null}

          <TableContainer
            sx={{
              maxHeight: 360,
              borderTop: 2,
              borderBottom: 2,
              borderColor: accentBlue,
              boxShadow: `0 10px 30px ${alpha(theme.palette.primary.main, 0.12)}`,
              ...tableScrollbarSx
            }}
          >
            <Table stickyHeader size="small" sx={{ minWidth: 1700 }}>
              <TableHead>
                <TableRow
                  sx={{
                    '& .MuiTableCell-root': {
                      borderBottomWidth: 3,
                      borderBottomColor: accentBlue,
                      bgcolor: headerBlue,
                      color: theme.palette.text.primary,
                      whiteSpace: 'nowrap'
                    }
                  }}
                >
                  <TableCell sx={{ width: 56 }}>Select</TableCell>
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
                  <TableRow sx={{ bgcolor: rowSurface }}>
                    <TableCell colSpan={14}>
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
                  return (
                    <TableRow
                      key={row.predictionRunId}
                      hover
                      selected={isSelected}
                      onClick={() => setSelectedPredictionRunId(row.predictionRunId)}
                      sx={{
                        cursor: 'pointer',
                        bgcolor: rowSurface,
                        '&:hover': {
                          bgcolor: alpha(theme.palette.primary.main, 0.14)
                        }
                      }}
                    >
                      <TableCell padding="checkbox">
                        <Radio checked={isSelected} onChange={() => setSelectedPredictionRunId(row.predictionRunId)} />
                      </TableCell>
                      <TableCell>{formatDateTime(row.createdAt)}</TableCell>
                      <TableCell>{row.modelVersionTag || '—'}</TableCell>
                      <TableCell>{row.crop || '—'}</TableCell>
                      <TableCell>{row.variety || '—'}</TableCell>
                      <TableCell>{row.season ?? '—'}</TableCell>
                      <TableCell>{row.state || '—'}</TableCell>
                      <TableCell>{row.county || '—'}</TableCell>
                      <TableCell align="right">{formatNumber(row.predictedYield)}</TableCell>
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

          <Stack direction="row" sx={{ justifyContent: 'flex-end', p: 2 }}>
            <Button
              variant="contained"
              disabled={!selectedPrediction || isLoading}
              onClick={handleAnalyzePrediction}
              sx={{
                '&.Mui-disabled': {
                  backgroundColor: theme.palette.grey[500],
                  color: alpha(theme.palette.text.primary, 0.5)
                }
              }}
            >
              Analyze Prediction
            </Button>
          </Stack>
        </Paper>

        <Divider />

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
          <Stack spacing={2.5}>
            <Typography variant="h5">Prediction Analysis</Typography>

            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              <Chip label={`Prediction #${analyzedPrediction.predictionRunId}`} color="primary" />
              <Chip label={`Model: ${analyzedPrediction.modelVersionTag || 'Unknown'}`} variant="outlined" />
              <Chip label={`Crop: ${analyzedPrediction.crop || 'Unknown'}`} variant="outlined" />
            </Stack>

            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 3 }}>
                <MetricCard label="Predicted Yield" value={`${formatNumber(analyzedPrediction.predictedYield)} bu/ac`} />
              </Grid>
              <Grid size={{ xs: 12, md: 3 }}>
                <MetricCard
                  label="Confidence Interval"
                  value={`${formatNumber(analyzedPrediction.confidenceLower)} - ${formatNumber(analyzedPrediction.confidenceUpper)}`}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 3 }}>
                <MetricCard
                  label="Regional Average"
                  value={`${formatNumber(analyzedPrediction.regionalAvgYield)} bu/ac`}
                  helper="From regional comparison at prediction time"
                />
              </Grid>
              <Grid size={{ xs: 12, md: 3 }}>
                <MetricCard label="Created At" value={formatDateTime(analyzedPrediction.createdAt)} />
              </Grid>
            </Grid>

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
                  Model Configuration Used
                </Typography>
                <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                  <Chip label={`Version: ${analyzedPrediction.modelVersionTag || 'Unknown'}`} variant="outlined" />
                  <Chip
                    label={`Type: ${modelTypesByVersionId[analyzedPrediction.modelVersionId] || analyzedPrediction.responsePayload?.model_type || 'Unknown'}`}
                    variant="outlined"
                  />
                  <Chip label={`Model Version ID: ${analyzedPrediction.modelVersionId ?? '—'}`} variant="outlined" />
                  <Chip label={`Runtime Model: ${analyzedPrediction.runtimeModelVersion || 'Unknown'}`} variant="outlined" />
                </Stack>
              </Stack>
            </Paper>

            <Grid container spacing={2}>
              <Grid size={{ xs: 12, lg: 6 }}>
                <MainCard
                  title="Nutrient Inputs"
                  content={false}
                  sx={{
                    bgcolor: graphCardSurface,
                    border: `1px solid ${graphCardBorder}`,
                    '& .MuiCardHeader-root': {
                      bgcolor: graphCardHeaderSurface,
                      borderBottom: `1px solid ${graphCardBorder}`
                    },
                    '& .MuiCardHeader-title': {
                      color: alpha(theme.palette.primary.light, 0.92),
                      fontWeight: 600,
                      letterSpacing: '0.02em',
                      textTransform: 'uppercase',
                      textShadow: `0 0 10px ${alpha(theme.palette.primary.main, 0.28)}`
                    }
                  }}
                >
                  <Box sx={{ p: 2 }}>
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
                </MainCard>
              </Grid>
              <Grid size={{ xs: 12, lg: 6 }}>
                <MainCard
                  title="Yield Context"
                  content={false}
                  sx={{
                    bgcolor: graphCardSurface,
                    border: `1px solid ${graphCardBorder}`,
                    '& .MuiCardHeader-root': {
                      bgcolor: graphCardHeaderSurface,
                      borderBottom: `1px solid ${graphCardBorder}`
                    },
                    '& .MuiCardHeader-title': {
                      color: alpha(theme.palette.primary.light, 0.92),
                      fontWeight: 600,
                      letterSpacing: '0.02em',
                      textTransform: 'uppercase',
                      textShadow: `0 0 10px ${alpha(theme.palette.primary.main, 0.28)}`
                    }
                  }}
                >
                  <Box sx={{ p: 2 }}>
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
            </Grid>

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
                                <Box sx={{ height: 8, borderRadius: 1, bgcolor: alpha(theme.palette.primary.main, 0.18), overflow: 'hidden' }}>
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
                    <MetricCard label="Crop" value={analyzedPrediction.crop || '—'} />
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
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <MetricCard label="Latitude" value={formatNumber(analyzedPrediction.lat, 6)} />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <MetricCard label="Longitude" value={formatNumber(analyzedPrediction.long, 6)} />
                  </Grid>
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
        )}
      </Stack>
    </MainCard>
  );
}
