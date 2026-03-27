import { useMemo, useState } from 'react';

import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';

import MainCard from 'components/MainCard';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

export default function Predict() {
  const [formValues, setFormValues] = useState({
    crop: 'Sorghum',
    latitude: '37.567',
    longitude: '-99.936',
    totalN: '65.6',
    totalP: '45.2',
    totalK: '30.1',
    acres: '47.07',
    season: 2025,
    waterApplied: '',
    state: '',
    county: '',
    variety: 'Pioneer 86P20'
  });

  const [predictionResult, setPredictionResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const seasonYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: currentYear - 1950 + 1 }, (_, index) => currentYear - index);
  }, []);

  const states = useMemo(
    () => [
      'Alabama',
      'Alaska',
      'Arizona',
      'Arkansas',
      'California',
      'Colorado',
      'Connecticut',
      'Delaware',
      'Florida',
      'Georgia',
      'Hawaii',
      'Idaho',
      'Illinois',
      'Indiana',
      'Iowa',
      'Kansas',
      'Kentucky',
      'Louisiana',
      'Maine',
      'Maryland',
      'Massachusetts',
      'Michigan',
      'Minnesota',
      'Mississippi',
      'Missouri',
      'Montana',
      'Nebraska',
      'Nevada',
      'New Hampshire',
      'New Jersey',
      'New Mexico',
      'New York',
      'North Carolina',
      'North Dakota',
      'Ohio',
      'Oklahoma',
      'Oregon',
      'Pennsylvania',
      'Rhode Island',
      'South Carolina',
      'South Dakota',
      'Tennessee',
      'Texas',
      'Utah',
      'Vermont',
      'Virginia',
      'Washington',
      'West Virginia',
      'Wisconsin',
      'Wyoming'
    ],
    []
  );

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormValues((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  const buildPayload = () => {
    return {
      crop: formValues.crop,
      variety: formValues.variety || null,
      acres: formValues.acres === '' ? null : Number(formValues.acres),
      lat: formValues.latitude === '' ? null : Number(formValues.latitude),
      long: formValues.longitude === '' ? null : Number(formValues.longitude),
      season: formValues.season === '' ? null : Number(formValues.season),
      totalN_per_ac: formValues.totalN === '' ? null : Number(formValues.totalN),
      totalP_per_ac: formValues.totalP === '' ? null : Number(formValues.totalP),
      totalK_per_ac: formValues.totalK === '' ? null : Number(formValues.totalK),
      water_applied_mm: formValues.waterApplied === '' ? null : Number(formValues.waterApplied),
      state: formValues.state || null,
      county: formValues.county || null
    };
  };

  const handleSubmit = async () => {
    setErrorMessage('');
    setPredictionResult(null);
    setIsSubmitting(true);

    try {
      const payload = buildPayload();

      const response = await fetch(`${API_BASE_URL}/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Request failed: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      setPredictionResult(result);
    } catch (error) {
      setErrorMessage(error.message || 'Something went wrong while requesting a prediction.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <MainCard title="Yield Intelligence Prediction">
      <Stack spacing={2.5}>
        <Typography variant="body1" color="text.primary">
          Select an existing field or enter crop, location, season, N/P/K manually; submit to get predicted yield, confidence interval, and
          key factors.
        </Typography>

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle2">Crop</Typography>
              <TextField
                select
                fullWidth
                name="crop"
                value={formValues.crop}
                onChange={handleChange}
                SelectProps={{
                  displayEmpty: true,
                  renderValue: (selected) => selected || 'Select Crop'
                }}
              >
                <MenuItem value="" disabled>
                  Select Crop
                </MenuItem>
                <MenuItem value="Sorghum">Sorghum</MenuItem>
                <MenuItem value="Winter Wheat">Wheat, Hard Winter</MenuItem>
                <MenuItem value="Grain">Fallow</MenuItem>
              </TextField>
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle2">Variety</Typography>
              <TextField fullWidth name="variety" placeholder="Pioneer 86P20" value={formValues.variety} onChange={handleChange} />
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle2">Latitude</Typography>
              <TextField fullWidth name="latitude" placeholder="00.000000" value={formValues.latitude} onChange={handleChange} />
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle2">Longitude</Typography>
              <TextField fullWidth name="longitude" placeholder="000.000000" value={formValues.longitude} onChange={handleChange} />
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle2">Total N (lb/ac)</Typography>
              <TextField fullWidth name="totalN" placeholder="00.00" value={formValues.totalN} onChange={handleChange} />
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle2">Total P (lb/ac)</Typography>
              <TextField fullWidth name="totalP" placeholder="00.00" value={formValues.totalP} onChange={handleChange} />
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle2">Total K (lb/ac)</Typography>
              <TextField fullWidth name="totalK" placeholder="00.00" value={formValues.totalK} onChange={handleChange} />
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle2">Acres</Typography>
              <TextField fullWidth name="acres" placeholder="00.00" value={formValues.acres} onChange={handleChange} />
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle2">Season</Typography>
              <TextField
                select
                fullWidth
                name="season"
                value={formValues.season}
                onChange={handleChange}
                SelectProps={{
                  displayEmpty: true,
                  renderValue: (selected) => selected || 'Select Season'
                }}
              >
                <MenuItem value="" disabled>
                  Select Season
                </MenuItem>
                {seasonYears.map((year) => (
                  <MenuItem key={year} value={year}>
                    {year}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle2">Water Applied (mm)</Typography>
              <TextField fullWidth name="waterApplied" placeholder="00.00" value={formValues.waterApplied} onChange={handleChange} />
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle2">State</Typography>
              <TextField
                select
                fullWidth
                name="state"
                value={formValues.state}
                onChange={handleChange}
                SelectProps={{
                  displayEmpty: true,
                  renderValue: (selected) => selected || 'Select State'
                }}
              >
                <MenuItem value="" disabled>
                  Select State
                </MenuItem>
                {states.map((state) => (
                  <MenuItem key={state} value={state}>
                    {state}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle2">County</Typography>
              <TextField fullWidth name="county" placeholder="County" value={formValues.county} onChange={handleChange} />
            </Stack>
          </Grid>

          <Grid size={12}>
            <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
              <Button variant="contained" onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? 'Running...' : 'Run Yield Intelligence'}
              </Button>
            </Stack>
          </Grid>
        </Grid>

        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

        {predictionResult && (
          <>
            <Divider />
            <Stack spacing={1.5}>
              <Typography variant="h6">Prediction Result</Typography>
              <Typography>
                <strong>Predicted Yield:</strong> {predictionResult.predicted_yield}
              </Typography>
              <Typography>
                <strong>Confidence Interval:</strong> {predictionResult.confidence_interval?.[0]} -{' '}
                {predictionResult.confidence_interval?.[1]}
              </Typography>
              <Typography>
                <strong>Model Version:</strong> {predictionResult.model_version}
              </Typography>

              {predictionResult.explainability?.top_features?.length > 0 && (
                <Stack spacing={0.5}>
                  <Typography variant="subtitle1">Top Features</Typography>
                  {predictionResult.explainability.top_features.map((feature, index) => (
                    <Typography key={`${feature.feature}-${index}`}>
                      {feature.feature}: {String(feature.value)} ({feature.direction}, importance: {feature.importance})
                    </Typography>
                  ))}
                </Stack>
              )}
            </Stack>
          </>
        )}
      </Stack>
    </MainCard>
  );
}
