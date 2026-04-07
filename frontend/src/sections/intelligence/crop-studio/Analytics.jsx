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

async function fetchPredictionRuns(signal) {
  const response = await fetch(`${API_BASE_URL}/predict/history?limit=500&page=1`, { signal });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to load prediction runs (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : [];

  return rows.map((row) => ({
    predictionRunId: row.prediction_run_id,
    createdAt: row.created_at,
    modelVersionTag: row.model_version_tag || '',
    modelVersionId: row.model_version_id,
    crop: row.crop || '',
    variety: row.variety || '',
    season: toNumberOrNull(row.season),
    state: row.state || '',
    county: row.county || '',
    acres: toNumberOrNull(row.acres),
    totalN: toNumberOrNull(row.totalN_per_ac),
    totalP: toNumberOrNull(row.totalP_per_ac),
    totalK: toNumberOrNull(row.totalK_per_ac),
    waterApplied: toNumberOrNull(row.water_applied_mm),
    predictedYield: toNumberOrNull(row.predicted_yield),
    confidenceLower: toNumberOrNull(row.confidence_lower),
    confidenceUpper: toNumberOrNull(row.confidence_upper),
    regionalAvgYield: toNumberOrNull(row?.regional_comparison?.avg_yield),
    requestPayload: row.request_payload || {},
    responsePayload: row.response_payload || {}
  }));
}

function MetricCard({ label, value, helper }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
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

export default function Analytics({ preselectedPredictionRunId = null }) {
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
  const [predictionRuns, setPredictionRuns] = useState([]);
  const [selectedPredictionRunId, setSelectedPredictionRunId] = useState(null);
  const [analyzedPrediction, setAnalyzedPrediction] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    const loadPredictionRuns = async () => {
      setIsLoading(true);
      setLoadError('');
      try {
        const rows = await fetchPredictionRuns(controller.signal);
        setPredictionRuns(rows);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setLoadError(error.message || 'Failed to load saved predictions.');
          setPredictionRuns([]);
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
    <MainCard title="Analytics">
      <Stack spacing={2.5}>
        <Typography variant="body1" color="text.primary">
          Select a saved prediction from the table, then run analysis using the exact values used for that prediction.
        </Typography>

        {loadError ? <Alert severity="error">{loadError}</Alert> : null}

        <Paper variant="outlined">
          <Stack spacing={1.5} sx={{ p: 2 }}>
            <Typography variant="h6">Predictions Table</Typography>
            <Typography variant="body2" color="text.secondary">
              Only one prediction can be selected at a time.
            </Typography>
          </Stack>

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
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow
                  sx={{
                    '& .MuiTableCell-root': {
                      borderBottomWidth: 3,
                      borderBottomColor: accentBlue,
                      bgcolor: headerBlue,
                      color: theme.palette.text.primary
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
                  <TableRow>
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
                      sx={{ cursor: 'pointer' }}
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
            <Button variant="contained" disabled={!selectedPrediction || isLoading} onClick={handleAnalyzePrediction}>
              Analyze Prediction
            </Button>
          </Stack>
        </Paper>

        <Divider />

        {!analyzedPrediction ? (
          <Alert severity="info">
            Select one prediction from the table above and click <strong>Analyze Prediction</strong> to populate this section.
          </Alert>
        ) : (
          <Stack spacing={2.5}>
            <Typography variant="h6">Prediction Analysis</Typography>

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

            <Grid container spacing={2}>
              <Grid size={{ xs: 12, lg: 6 }}>
                <MainCard title="Nutrient Inputs" content={false}>
                  <Box sx={{ p: 2 }}>
                    <BarChart
                      height={280}
                      xAxis={[{ scaleType: 'band', data: ['N (lb/ac)', 'P (lb/ac)', 'K (lb/ac)'] }]}
                      series={[{ data: nutrientSeries, label: 'Input Amount' }]}
                    />
                  </Box>
                </MainCard>
              </Grid>
              <Grid size={{ xs: 12, lg: 6 }}>
                <MainCard title="Yield Context" content={false}>
                  <Box sx={{ p: 2 }}>
                    <BarChart
                      height={280}
                      xAxis={[{ scaleType: 'band', data: ['Lower CI', 'Predicted', 'Upper CI', 'Regional Avg'] }]}
                      series={[{ data: yieldContextSeries, label: 'Yield (bu/ac)' }]}
                    />
                  </Box>
                </MainCard>
              </Grid>
            </Grid>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={0.75}>
                <Typography variant="subtitle2">Prediction Inputs Used</Typography>
                <Typography variant="body2" color="text.secondary">
                  State: {analyzedPrediction.state || '—'} | County: {analyzedPrediction.county || '—'} | Season:{' '}
                  {analyzedPrediction.season ?? '—'} | Acres: {formatNumber(analyzedPrediction.acres)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Water Applied: {formatNumber(analyzedPrediction.waterApplied)} mm
                </Typography>
              </Stack>
            </Paper>
          </Stack>
        )}
      </Stack>
    </MainCard>
  );
}
