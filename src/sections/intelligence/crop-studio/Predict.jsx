import { useMemo, useState } from 'react';

import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';

import MainCard from 'components/MainCard';

export default function Predict() {
  const [formValues, setFormValues] = useState({
    crop: '',
    latitude: '',
    longitude: '',
    totalN: '',
    totalP: '',
    totalK: '',
    acres: '',
    season: '',
    waterApplied: '',
    state: '',
    county: ''
  });

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
                  renderValue: (selected) => selected || 'Select States'
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
              <Button variant="contained">Run Yield Intelligence</Button>
            </Stack>
          </Grid>
        </Grid>
      </Stack>
    </MainCard>
  );
}
