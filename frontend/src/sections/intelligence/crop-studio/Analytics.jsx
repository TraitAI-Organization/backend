import { useEffect, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { BarChart, ScatterChart } from '@mui/x-charts';

import MainCard from 'components/MainCard';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

async function fetchAnalyticsRows(signal) {
  const limit = 500;
  let page = 1;
  let pages = 1;
  const allRows = [];

  while (page <= pages) {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit)
    });
    const response = await fetch(`${API_BASE_URL}/fields?${params.toString()}`, { signal });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to load analytics records (${response.status}): ${errorText}`);
    }

    const payload = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    allRows.push(...rows);

    const reportedPages = Number(payload?.pages) || 0;
    pages = reportedPages > 0 ? reportedPages : 1;
    page += 1;

    if (reportedPages === 0) break;
  }

  return allRows.map((row, index) => ({
    id: row.field_season_id ?? row.field_number ?? `field-${index + 1}`,
    crop: row.crop || '',
    state: row.state || '',
    season: toNumberOrNull(row.season),
    observedYield: toNumberOrNull(row.yield_bu_ac),
    predictedYield: toNumberOrNull(row.predicted_yield)
  }));
}

export default function Analytics() {
  const theme = useTheme();
  const palette = theme.vars?.palette ?? theme.palette;
  const chartHeight = 340;
  const chartMargin = { top: 16, right: 14, bottom: 26, left: 30 };
  const [filters, setFilters] = useState({
    crop: '',
    state: '',
    season: ''
  });
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    const loadRows = async () => {
      setIsLoading(true);
      setLoadError('');
      try {
        const data = await fetchAnalyticsRows(controller.signal);
        setRows(data);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setLoadError(error.message || 'Failed to load analytics records.');
          setRows([]);
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadRows();

    return () => {
      controller.abort();
    };
  }, []);

  const cropOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.crop).filter((crop) => typeof crop === 'string' && crop.trim().length > 0))).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      ),
    [rows]
  );

  const seasonOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.season).filter((season) => typeof season === 'number' && Number.isFinite(season)))).sort(
        (a, b) => b - a
      ),
    [rows]
  );

  const stateOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.state).filter((state) => typeof state === 'string' && state.trim().length > 0))).sort(
        (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })
      ),
    [rows]
  );

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (filters.crop && row.crop !== filters.crop) return false;
        if (filters.state && row.state !== filters.state) return false;
        if (filters.season && String(row.season) !== String(filters.season)) return false;
        return true;
      }),
    [filters.crop, filters.season, filters.state, rows]
  );

  const observedRows = useMemo(
    () => filteredRows.filter((row) => typeof row.observedYield === 'number' && Number.isFinite(row.observedYield)),
    [filteredRows]
  );

  const predictedRows = useMemo(
    () => filteredRows.filter((row) => typeof row.predictedYield === 'number' && Number.isFinite(row.predictedYield)),
    [filteredRows]
  );

  const scatterRows = useMemo(
    () =>
      filteredRows.filter(
        (row) =>
          typeof row.observedYield === 'number' &&
          Number.isFinite(row.observedYield) &&
          typeof row.predictedYield === 'number' &&
          Number.isFinite(row.predictedYield)
      ),
    [filteredRows]
  );

  const histogram = useMemo(() => {
    if (observedRows.length === 0) {
      return { labels: [], counts: [] };
    }

    const binSize = 10;
    const values = observedRows.map((row) => row.observedYield);
    const min = Math.floor(Math.min(...values) / binSize) * binSize;
    const max = Math.ceil(Math.max(...values) / binSize) * binSize + binSize;

    const labels = [];
    const counts = [];

    for (let start = min; start < max; start += binSize) {
      labels.push(`${start}-${start + binSize}`);
      counts.push(0);
    }

    values.forEach((value) => {
      const bucketIndex = Math.min(Math.floor((value - min) / binSize), counts.length - 1);
      counts[bucketIndex] += 1;
    });

    return { labels, counts };
  }, [observedRows]);

  const scatterData = useMemo(() => scatterRows.map((row) => ({ id: row.id, x: row.observedYield, y: row.predictedYield })), [scatterRows]);

  const scatterBounds = useMemo(() => {
    if (scatterRows.length === 0) {
      return { min: 0, max: 120 };
    }

    const allValues = scatterRows.flatMap((row) => [row.observedYield, row.predictedYield]);
    const min = Math.floor(Math.min(...allValues) / 10) * 10 - 5;
    const max = Math.ceil(Math.max(...allValues) / 10) * 10 + 5;
    return { min, max };
  }, [scatterRows]);

  const avgObservedYield = useMemo(() => {
    if (observedRows.length === 0) return 0;
    return observedRows.reduce((sum, row) => sum + row.observedYield, 0) / observedRows.length;
  }, [observedRows]);

  const avgPredictedYield = useMemo(() => {
    if (predictedRows.length === 0) return 0;
    return predictedRows.reduce((sum, row) => sum + row.predictedYield, 0) / predictedRows.length;
  }, [predictedRows]);

  const allRowsWithPrediction = useMemo(
    () => rows.filter((row) => typeof row.predictedYield === 'number' && Number.isFinite(row.predictedYield)),
    [rows]
  );

  const baselineRows = useMemo(() => {
    const scoped = allRowsWithPrediction.filter((row) => {
      if (filters.state && row.state !== filters.state) return false;
      if (filters.season && String(row.season) !== String(filters.season)) return false;
      return true;
    });

    return scoped.length > 0 ? scoped : allRowsWithPrediction;
  }, [allRowsWithPrediction, filters.season, filters.state]);

  const regionalSeasonAvg = useMemo(() => {
    if (baselineRows.length === 0) return 0;
    return baselineRows.reduce((sum, row) => sum + row.predictedYield, 0) / baselineRows.length;
  }, [baselineRows]);

  const deltaFromRegionalSeasonAvg = avgPredictedYield - regionalSeasonAvg;

  const confidencePct = useMemo(() => {
    if (scatterRows.length === 0) return 0;
    const mae = scatterRows.reduce((sum, row) => sum + Math.abs(row.predictedYield - row.observedYield), 0) / scatterRows.length;
    return Math.max(55, Math.min(99, Math.round(100 - mae * 2.2)));
  }, [scatterRows]);

  const confidenceColor = confidencePct >= 85 ? 'success' : confidencePct >= 70 ? 'warning' : 'error';
  const confidenceLabel = confidencePct >= 85 ? 'High confidence' : confidencePct >= 70 ? 'Moderate confidence' : 'Lower confidence';

  const handleFilterChange = (event) => {
    const { name, value } = event.target;
    setFilters((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  return (
    <MainCard title="Analytics">
      <Stack spacing={2.5}>
        <Typography variant="body1" color="text.primary">
          Yield distribution histogram and Predicted vs Observed scatter plot from live field-season data.
        </Typography>

        {loadError ? (
          <Typography variant="body2" color="error.main">
            {loadError}
          </Typography>
        ) : null}
        {isLoading ? (
          <Typography variant="body2" color="text.secondary">
            Loading analytics records...
          </Typography>
        ) : null}

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 4 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle2">Crop</Typography>
              <TextField
                select
                fullWidth
                name="crop"
                value={filters.crop}
                onChange={handleFilterChange}
                disabled={isLoading}
                SelectProps={{ displayEmpty: true, renderValue: (selected) => selected || 'All Crops' }}
              >
                <MenuItem value="">All Crops</MenuItem>
                {cropOptions.map((crop) => (
                  <MenuItem key={crop} value={crop}>
                    {crop}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 4 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle2">Season</Typography>
              <TextField
                select
                fullWidth
                name="season"
                value={filters.season}
                onChange={handleFilterChange}
                disabled={isLoading}
                SelectProps={{ displayEmpty: true, renderValue: (selected) => selected || 'All Seasons' }}
              >
                <MenuItem value="">All Seasons</MenuItem>
                {seasonOptions.map((season) => (
                  <MenuItem key={season} value={season}>
                    {season}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 4 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle2">State</Typography>
              <TextField
                select
                fullWidth
                name="state"
                value={filters.state}
                onChange={handleFilterChange}
                disabled={isLoading}
                SelectProps={{ displayEmpty: true, renderValue: (selected) => selected || 'All States' }}
              >
                <MenuItem value="">All States</MenuItem>
                {stateOptions.map((state) => (
                  <MenuItem key={state} value={state}>
                    {state}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
          </Grid>
        </Grid>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Box
            sx={{
              px: 1.5,
              py: 0.75,
              borderRadius: 1,
              bgcolor: 'rgb(17, 26, 34)',
              border: '1px solid rgb(64, 102, 140)'
            }}
          >
            <Typography variant="subtitle2" sx={{ color: '#C7ECF0' }}>
              Records: {filteredRows.length}
            </Typography>
          </Box>
          <Box
            sx={{
              px: 1.5,
              py: 0.75,
              borderRadius: 1,
              bgcolor: 'rgb(17, 26, 34)',
              border: '1px solid rgb(64, 102, 140)'
            }}
          >
            <Typography variant="subtitle2" sx={{ color: '#C7ECF0' }}>
              Avg Observed Yield: {avgObservedYield.toFixed(1)} bu/ac
            </Typography>
          </Box>
        </Stack>

        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, lg: 6 }}>
            <MainCard title="Yield Distribution Histogram" content={false}>
              {histogram.counts.length > 0 ? (
                <Box>
                  <BarChart
                    hideLegend
                    height={chartHeight}
                    grid={{ horizontal: true }}
                    series={[{ data: histogram.counts, label: 'Field Count', color: palette.primary.main }]}
                    xAxis={[
                      {
                        data: histogram.labels,
                        scaleType: 'band',
                        tickSize: 6,
                        disableLine: true,
                        categoryGapRatio: 0.18,
                        tickLabelInterval: () => true,
                        tickLabelStyle: { fontSize: 11 }
                      }
                    ]}
                    yAxis={[{ label: 'Field-Season Count', tickSize: 6, disableLine: true }]}
                    margin={chartMargin}
                    sx={{
                      '& .MuiBarElement-root': {
                        filter: `drop-shadow(0 0 6px ${palette.primary.main})`
                      },
                      '& .MuiBarElement-root:hover': { opacity: 0.7 },
                      '& .MuiChartsGrid-line': { stroke: palette.divider, strokeDasharray: '4 4' },
                      '& .MuiChartsAxis-root.MuiChartsAxis-directionX .MuiChartsAxis-tick': { stroke: 'transparent' },
                      '& .MuiChartsAxis-root.MuiChartsAxis-directionY .MuiChartsAxis-tick': { stroke: 'transparent' }
                    }}
                  />
                  <Stack
                    direction="row"
                    sx={{ gap: 1.25, alignItems: 'center', justifyContent: 'center', py: 1, borderTop: 1, borderColor: 'divider' }}
                  >
                    <Box sx={{ width: 12, height: 12, borderRadius: 0.75, bgcolor: 'primary.main' }} />
                    <Typography variant="caption" color="text.secondary">
                      Field Count by Yield Bin
                    </Typography>
                  </Stack>
                </Box>
              ) : (
                <Box sx={{ p: 3 }}>
                  <Typography variant="body2" color="text.secondary">
                    No rows with observed yield match the active filters.
                  </Typography>
                </Box>
              )}
            </MainCard>
          </Grid>

          <Grid size={{ xs: 12, lg: 6 }}>
            <MainCard title="Predicted vs Observed Scatter" content={false}>
              {scatterData.length > 0 ? (
                <Box>
                  <ScatterChart
                    hideLegend
                    height={chartHeight}
                    grid={{ horizontal: true, vertical: true }}
                    series={[{ label: 'Field-Season', data: scatterData, markerSize: 7, color: palette.info.main }]}
                    xAxis={[{ min: scatterBounds.min, max: scatterBounds.max, label: 'Observed Yield (bu/ac)' }]}
                    yAxis={[{ min: scatterBounds.min, max: scatterBounds.max, label: 'Predicted Yield (bu/ac)' }]}
                    margin={chartMargin}
                    sx={{
                      '& .MuiMarkElement-root': {
                        filter: `drop-shadow(0 0 5px ${palette.info.main})`
                      },
                      '& .MuiChartsGrid-line': { stroke: palette.divider, strokeDasharray: '4 4' }
                    }}
                  />
                  <Stack
                    direction="row"
                    sx={{ gap: 2.25, alignItems: 'center', justifyContent: 'center', py: 1, borderTop: 1, borderColor: 'divider' }}
                  >
                    <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center' }}>
                      <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: 'info.main' }} />
                      <Typography variant="caption" color="text.secondary">
                        Field-Season Points
                      </Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      X: Observed Yield | Y: Predicted Yield
                    </Typography>
                  </Stack>
                </Box>
              ) : (
                <Box sx={{ p: 3 }}>
                  <Typography variant="body2" color="text.secondary">
                    No rows with both observed and predicted yield match the active filters.
                  </Typography>
                </Box>
              )}
            </MainCard>
          </Grid>
        </Grid>

        <MainCard title="Model Signal Snapshot">
          <Grid container spacing={2.5}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Stack spacing={1.25}>
                <Typography variant="subtitle1">Uncertainty / Confidence Indicator</Typography>
                <Typography variant="body2" color="text.secondary">
                  {confidenceLabel} based on prediction error spread across the active filter set.
                </Typography>
                <LinearProgress color={confidenceColor} variant="determinate" value={confidencePct} sx={{ height: 10, borderRadius: 2 }} />
                <Typography variant="h6">{confidencePct}% confidence score</Typography>
              </Stack>
            </Grid>
            <Grid
              size={{ xs: 12, md: 6 }}
              sx={{
                borderTop: { xs: 1, md: 0 },
                borderLeft: { xs: 0, md: 1 },
                borderColor: 'divider',
                pt: { xs: 2.5, md: 0 },
                pl: { xs: 0, md: 2.5 }
              }}
            >
              <Stack spacing={1.25}>
                <Typography variant="subtitle1">Difference From Regional / Season Average</Typography>
                <Typography variant="body2" color="text.secondary">
                  Delta compares the current filtered predicted average to the regional-season baseline.
                </Typography>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                  <Typography variant="h4" color={deltaFromRegionalSeasonAvg >= 0 ? 'success.main' : 'error.main'}>
                    {deltaFromRegionalSeasonAvg >= 0 ? '+' : ''}
                    {deltaFromRegionalSeasonAvg.toFixed(1)} bu/ac
                  </Typography>
                  <Chip
                    size="small"
                    color={deltaFromRegionalSeasonAvg >= 0 ? 'success' : 'error'}
                    label={deltaFromRegionalSeasonAvg >= 0 ? 'Above baseline' : 'Below baseline'}
                  />
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  Baseline predicted average: {regionalSeasonAvg.toFixed(1)} bu/ac | Current filtered average:{' '}
                  {avgPredictedYield.toFixed(1)} bu/ac
                </Typography>
              </Stack>
            </Grid>
          </Grid>
        </MainCard>
      </Stack>
    </MainCard>
  );
}
