import { useMemo, useState } from 'react';

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

const cropOptions = ['Sorghum', 'Winter Wheat', 'Grain', 'Corn', 'Soybean'];
const stateOptions = ['Kansas', 'Nebraska', 'Iowa', 'Oklahoma', 'Texas'];
const seasonOptions = [2021, 2022, 2023, 2024, 2025];

function buildMockRows() {
  const rows = [];
  let id = 1;

  for (let seasonIndex = 0; seasonIndex < seasonOptions.length; seasonIndex += 1) {
    for (let cropIndex = 0; cropIndex < cropOptions.length; cropIndex += 1) {
      for (let stateIndex = 0; stateIndex < stateOptions.length; stateIndex += 1) {
        const baseYield = 48 + cropIndex * 11 + seasonIndex * 4 + stateIndex * 3;
        const observedYield = Number((baseYield + ((id * 7) % 22)).toFixed(1));
        const predictedYield = Number((observedYield + (((id * 13) % 15) - 7) * 0.8).toFixed(1));

        rows.push({
          id,
          crop: cropOptions[cropIndex],
          state: stateOptions[stateIndex],
          season: seasonOptions[seasonIndex],
          fieldId: 1000 + id,
          observedYield,
          predictedYield
        });
        id += 1;
      }
    }
  }

  return rows;
}

export default function Analytics() {
  const theme = useTheme();
  const chartHeight = 340;
  const chartMargin = { top: 16, right: 14, bottom: 26, left: 30 };
  const [filters, setFilters] = useState({
    crop: '',
    state: '',
    season: ''
  });

  const rows = useMemo(() => buildMockRows(), []);

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

  const histogram = useMemo(() => {
    if (filteredRows.length === 0) {
      return { labels: [], counts: [], min: 0, max: 0 };
    }

    const binSize = 10;
    const values = filteredRows.map((row) => row.observedYield);
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

    return { labels, counts, min, max };
  }, [filteredRows]);

  const scatterData = useMemo(
    () => filteredRows.map((row) => ({ id: row.id, x: row.observedYield, y: row.predictedYield })),
    [filteredRows]
  );

  const scatterBounds = useMemo(() => {
    if (filteredRows.length === 0) {
      return { min: 0, max: 120 };
    }

    const allValues = filteredRows.flatMap((row) => [row.observedYield, row.predictedYield]);
    const min = Math.floor(Math.min(...allValues) / 10) * 10 - 5;
    const max = Math.ceil(Math.max(...allValues) / 10) * 10 + 5;
    return { min, max };
  }, [filteredRows]);

  const avgObservedYield = useMemo(() => {
    if (filteredRows.length === 0) return 0;
    return filteredRows.reduce((sum, row) => sum + row.observedYield, 0) / filteredRows.length;
  }, [filteredRows]);

  const avgPredictedYield = useMemo(() => {
    if (filteredRows.length === 0) return 0;
    return filteredRows.reduce((sum, row) => sum + row.predictedYield, 0) / filteredRows.length;
  }, [filteredRows]);

  const baselineRows = useMemo(() => {
    const scoped = rows.filter((row) => {
      if (filters.state && row.state !== filters.state) return false;
      if (filters.season && String(row.season) !== String(filters.season)) return false;
      return true;
    });

    return scoped.length > 0 ? scoped : rows;
  }, [filters.season, filters.state, rows]);

  const regionalSeasonAvg = useMemo(() => {
    if (baselineRows.length === 0) return 0;
    return baselineRows.reduce((sum, row) => sum + row.predictedYield, 0) / baselineRows.length;
  }, [baselineRows]);

  const deltaFromRegionalSeasonAvg = avgPredictedYield - regionalSeasonAvg;

  const confidencePct = useMemo(() => {
    if (filteredRows.length === 0) return 0;
    const mae =
      filteredRows.reduce((sum, row) => sum + Math.abs(row.predictedYield - row.observedYield), 0) / filteredRows.length;
    return Math.max(55, Math.min(99, Math.round(100 - mae * 2.2)));
  }, [filteredRows]);

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
          Yield distribution histogram and Predicted vs Observed scatter plot from filtered field-season data.
        </Typography>

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
              Avg Observed Yield:{' '}
              {filteredRows.length > 0
                ? (filteredRows.reduce((sum, row) => sum + row.observedYield, 0) / filteredRows.length).toFixed(1)
                : '0.0'}{' '}
              bu/ac
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
                    series={[{ data: histogram.counts, label: 'Field Count', color: theme.vars.palette.primary.main }]}
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
                        filter: `drop-shadow(0 0 6px ${theme.vars.palette.primary.main})`
                      },
                      '& .MuiBarElement-root:hover': { opacity: 0.7 },
                      '& .MuiChartsGrid-line': { stroke: theme.vars.palette.divider, strokeDasharray: '4 4' },
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
                    No rows match the active filters.
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
                    series={[{ label: 'Field-Season', data: scatterData, markerSize: 7, color: theme.vars.palette.info.main }]}
                    xAxis={[{ min: scatterBounds.min, max: scatterBounds.max, label: 'Observed Yield (bu/ac)' }]}
                    yAxis={[{ min: scatterBounds.min, max: scatterBounds.max, label: 'Predicted Yield (bu/ac)' }]}
                    margin={chartMargin}
                    sx={{
                      '& .MuiMarkElement-root': {
                        filter: `drop-shadow(0 0 5px ${theme.vars.palette.info.main})`
                      },
                      '& .MuiChartsGrid-line': { stroke: theme.vars.palette.divider, strokeDasharray: '4 4' }
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
                    No rows match the active filters.
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
                  Baseline predicted average: {regionalSeasonAvg.toFixed(1)} bu/ac | Current filtered average: {avgPredictedYield.toFixed(1)} bu/ac
                </Typography>
              </Stack>
            </Grid>
          </Grid>
        </MainCard>
      </Stack>
    </MainCard>
  );
}
