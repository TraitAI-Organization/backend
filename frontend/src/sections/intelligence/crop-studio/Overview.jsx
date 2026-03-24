import { useMemo } from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import MainCard from 'components/MainCard';

function MetricTile({ label, value, helper }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Stack spacing={0.75}>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h4">{value}</Typography>
        {helper ? (
          <Typography variant="caption" color="text.secondary">
            {helper}
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
}

export default function Overview() {
  const overview = useMemo(
    () => ({
      total_field_seasons: 1280,
      total_fields: 214,
      seasons_available: [2021, 2022, 2023, 2024, 2025],
      crops_available: ['Sorghum', 'Winter Wheat', 'Grain', 'Corn', 'Soybean'],
      yield_range: {
        min: 38.7,
        max: 109.4,
        avg: 74.2
      },
      prediction_stats: {
        field_seasons_with_predictions: 1196,
        total_predictions: 9624,
        predicted_yield_avg: 76.8,
        predicted_yield_min: 36.1,
        predicted_yield_max: 112.3
      }
    }),
    []
  );

  const predStats = overview.prediction_stats || {};
  const totalFieldSeasons = overview.total_field_seasons || 0;
  const withPredictions = predStats.field_seasons_with_predictions || 0;
  const coveragePct = totalFieldSeasons ? (100 * withPredictions) / totalFieldSeasons : 0;

  return (
    <MainCard title="Overview">
      <Stack spacing={2.5}>
        <Stack spacing={0.75}>
          {/* <Typography variant="h5">Project Overview</Typography> */}
          <Typography variant="body2" color="text.primary">
            Summary metrics (field-seasons, crops, seasons), observed yield range, and prediction statistics (coverage, avg predicted
            yield).
          </Typography>
          <Typography variant="subtitle2" color="text.secondary">
            Nutrition AI - Agricultural Yield Prediction Platform
          </Typography>
        </Stack>

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
            <MetricTile
              label="Total Field-Seasons"
              value={overview.total_field_seasons.toLocaleString()}
              helper="All tracked field-season records"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
            <MetricTile label="Fields" value={overview.total_fields.toLocaleString()} helper="Distinct field IDs in the system" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
            <MetricTile label="Seasons" value={String(overview.seasons_available.length)} helper={overview.seasons_available.join(', ')} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
            <MetricTile label="Crops" value={String(overview.crops_available.length)} helper={overview.crops_available.join(', ')} />
          </Grid>
        </Grid>

        <Divider />

        <Stack spacing={1.5}>
          <Typography variant="h6">Observed Yield Range</Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 4 }}>
              <MetricTile label="Min Yield" value={`${overview.yield_range.min.toFixed(1)} bu/ac`} />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <MetricTile label="Max Yield" value={`${overview.yield_range.max.toFixed(1)} bu/ac`} />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <MetricTile label="Avg Yield" value={`${overview.yield_range.avg.toFixed(1)} bu/ac`} />
            </Grid>
          </Grid>
        </Stack>

        <Divider />

        <Stack spacing={1.5}>
          <Stack spacing={0.5}>
            <Typography variant="h6">Prediction Statistics</Typography>
            <Typography variant="caption" color="text.secondary">
              Aggregates from stored model predictions in the system.
            </Typography>
          </Stack>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={1.25}>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="subtitle2">Coverage</Typography>
                <Chip
                  size="small"
                  color={coveragePct >= 90 ? 'success' : coveragePct >= 75 ? 'warning' : 'error'}
                  label={`${coveragePct.toFixed(1)}%`}
                />
              </Stack>
              <LinearProgress
                variant="determinate"
                value={coveragePct}
                color={coveragePct >= 90 ? 'success' : coveragePct >= 75 ? 'warning' : 'error'}
                sx={{ height: 8, borderRadius: 2 }}
              />
              <Typography variant="caption" color="text.secondary">
                {withPredictions.toLocaleString()} of {totalFieldSeasons.toLocaleString()} field-seasons have predictions.
              </Typography>
            </Stack>
          </Paper>

          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, 1fr)',
                md: 'repeat(3, 1fr)',
                lg: 'repeat(5, 1fr)'
              }
            }}
          >
            <MetricTile label="Field-seasons with predictions" value={withPredictions.toLocaleString()} />
            <MetricTile label="Coverage" value={`${coveragePct.toFixed(1)}%`} />
            <MetricTile label="Total predictions" value={(predStats.total_predictions || 0).toLocaleString()} />
            <MetricTile label="Avg predicted yield" value={`${(predStats.predicted_yield_avg || 0).toFixed(1)} bu/ac`} />
            <MetricTile
              label="Predicted yield range"
              value={`${(predStats.predicted_yield_min || 0).toFixed(1)} - ${(predStats.predicted_yield_max || 0).toFixed(1)} bu/ac`}
            />
          </Box>
        </Stack>
      </Stack>
    </MainCard>
  );
}
