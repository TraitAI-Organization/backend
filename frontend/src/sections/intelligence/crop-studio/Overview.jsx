import { useEffect, useMemo, useState } from 'react';

import { alpha, useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import MainCard from 'components/MainCard';
import wheatHero from 'assets/images/overview/wheat.webp';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

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
  const theme = useTheme();
  const [overview, setOverview] = useState({
    total_field_seasons: 0,
    total_fields: 0,
    total_acres: 0,
    seasons_available: [],
    crops_available: [],
    yield_range: { min: 0, max: 0, avg: 0 },
    prediction_stats: {
      field_seasons_with_predictions: 0,
      total_predictions: 0,
      predicted_yield_avg: 0,
      predicted_yield_min: 0,
      predicted_yield_max: 0
    }
  });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    const loadOverview = async () => {
      setIsLoading(true);
      setLoadError('');
      try {
        const response = await fetch(`${API_BASE_URL}/fields/overview`, { signal: controller.signal });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to load overview (${response.status}): ${errorText}`);
        }

        const payload = await response.json();
        setOverview({
          total_field_seasons: payload?.total_field_seasons || 0,
          total_fields: payload?.total_fields || 0,
          total_acres: Number(payload?.total_acres) || 0,
          seasons_available: Array.isArray(payload?.seasons_available) ? payload.seasons_available : [],
          crops_available: Array.isArray(payload?.crops_available) ? payload.crops_available : [],
          yield_range: {
            min: Number(payload?.yield_range?.min) || 0,
            max: Number(payload?.yield_range?.max) || 0,
            avg: Number(payload?.yield_range?.avg) || 0
          },
          prediction_stats: {
            field_seasons_with_predictions: payload?.prediction_stats?.field_seasons_with_predictions || 0,
            total_predictions: payload?.prediction_stats?.total_predictions || 0,
            predicted_yield_avg: Number(payload?.prediction_stats?.predicted_yield_avg) || 0,
            predicted_yield_min: Number(payload?.prediction_stats?.predicted_yield_min) || 0,
            predicted_yield_max: Number(payload?.prediction_stats?.predicted_yield_max) || 0
          }
        });
      } catch (error) {
        if (error.name !== 'AbortError') {
          setLoadError(error.message || 'Failed to load overview metrics.');
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadOverview();

    return () => controller.abort();
  }, []);

  const predStats = overview.prediction_stats || {};
  const totalFieldSeasons = overview.total_field_seasons || 0;
  const withPredictions = predStats.field_seasons_with_predictions || 0;
  const coveragePct = totalFieldSeasons ? (100 * withPredictions) / totalFieldSeasons : 0;
  const cropsHelper = useMemo(() => {
    if (!Array.isArray(overview.crops_available)) return '';
    return overview.crops_available
      .map((crop) => (typeof crop === 'string' ? crop : crop?.crop_name))
      .filter(Boolean)
      .join(', ');
  }, [overview.crops_available]);

  return (
    <MainCard title="Overview">
      <Stack spacing={2.5}>
        <Paper
          variant="outlined"
          sx={{
            position: 'relative',
            overflow: 'hidden',
            borderColor: alpha(theme.palette.primary.main, 0.45),
            background: `linear-gradient(140deg, ${alpha(theme.palette.primary.dark, 0.36)} 0%, ${alpha(theme.palette.primary.main, 0.2)} 100%)`
          }}
        >
          <Grid container spacing={0}>
            <Grid size={{ xs: 12, md: 7 }}>
              <Stack spacing={1.5} sx={{ p: { xs: 2, md: 3 } }}>
                <Typography variant="h4">Wheat Trait Intelligence</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 580 }}>
                  Track crop performance, model coverage, and yield signals in one view. This dashboard blends observed field outcomes with
                  machine-learning predictions to help prioritize decisions quickly.
                </Typography>
                <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                  <Chip label="Wheat-focused analytics" size="small" sx={{ bgcolor: alpha(theme.palette.primary.main, 0.2) }} />
                  <Chip label="Live backend metrics" size="small" sx={{ bgcolor: alpha(theme.palette.primary.main, 0.2) }} />
                  <Chip label="Prediction readiness" size="small" sx={{ bgcolor: alpha(theme.palette.primary.main, 0.2) }} />
                </Stack>
              </Stack>
            </Grid>
            <Grid size={{ xs: 12, md: 5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-end', p: { xs: 1.5, md: 1.5 }, pt: 0 }}>
                <Box
                  component="img"
                  src={wheatHero}
                  alt="Stylized wheat field graphic"
                  sx={{
                    width: '100%',
                    maxWidth: 430,
                    borderRadius: 2,
                    opacity: 0.92,
                    filter: `drop-shadow(0 10px 20px ${alpha(theme.palette.common.black, 0.28)})`
                  }}
                />
              </Box>
            </Grid>
          </Grid>
        </Paper>

        <Stack spacing={0.75}>
          {/* <Typography variant="h5">Project Overview</Typography> */}
          <Typography variant="body2" color="text.primary">
            Summary Metrics (acres, fields, crops, seasons), observed yield range, and prediction statistics (coverage, avg predicted
            yield).
          </Typography>
          {loadError ? (
            <Typography variant="caption" color="error.main">
              {loadError}
            </Typography>
          ) : null}
          {isLoading ? (
            <Typography variant="caption" color="text.secondary">
              Loading overview metrics...
            </Typography>
          ) : null}
        </Stack>

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
            <MetricTile
              label="Total Acres"
              value={overview.total_acres.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              helper="Sum of acres across all fields"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
            <MetricTile label="Fields" value={overview.total_fields.toLocaleString()} helper="Distinct field IDs in the system" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
            <MetricTile label="Seasons" value={String(overview.seasons_available.length)} helper={overview.seasons_available.join(', ')} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
            <MetricTile label="Crops" value={String(overview.crops_available.length)} helper={cropsHelper} />
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
