import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

export default function PredictionInputStep({ formValues, onChange, crops, varieties, seasons, states, counties }) {
  const hasCrop = Boolean(formValues.crop);
  const hasVarietiesForCrop = varieties.length > 0;
  const isVarietyDisabled = !hasCrop || !hasVarietiesForCrop;

  return (
    <Stack spacing={2.5}>
      <Typography variant="h6">Step 2: Enter Prediction Inputs</Typography>
      <Typography variant="body2" color="text.secondary">
        Provide the agronomic and location values used to generate a yield prediction.
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
              onChange={onChange}
              SelectProps={{ displayEmpty: true, renderValue: (selected) => selected || 'Select a Crop..' }}
            >
              <MenuItem value="" disabled>
                Select a Crop..
              </MenuItem>
              {crops.map((crop) => (
                <MenuItem key={crop} value={crop}>
                  {crop}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">Variety</Typography>
            <TextField
              select
              fullWidth
              name="variety"
              value={formValues.variety}
              onChange={onChange}
              disabled={isVarietyDisabled}
              helperText={hasCrop && !hasVarietiesForCrop ? 'No variety available for selected crop' : undefined}
              SelectProps={{ displayEmpty: true, renderValue: (selected) => selected || 'Select a Variety..' }}
            >
              <MenuItem value="" disabled>
                Select a Variety..
              </MenuItem>
              {hasCrop && !hasVarietiesForCrop ? (
                <MenuItem value="" disabled>
                  No variety available for selected crop
                </MenuItem>
              ) : null}
              {varieties.map((variety) => (
                <MenuItem key={variety} value={variety}>
                  {variety}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">Latitude</Typography>
            <TextField fullWidth name="latitude" placeholder="00.000" value={formValues.latitude} onChange={onChange} />
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">Longitude</Typography>
            <TextField fullWidth name="longitude" placeholder="00.00000" value={formValues.longitude} onChange={onChange} />
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">Total N (lb/ac)</Typography>
            <TextField fullWidth name="totalN" placeholder="00.00" value={formValues.totalN} onChange={onChange} />
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">Total P (lb/ac)</Typography>
            <TextField fullWidth name="totalP" placeholder="00.00" value={formValues.totalP} onChange={onChange} />
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">Total K (lb/ac)</Typography>
            <TextField fullWidth name="totalK" placeholder="00.00" value={formValues.totalK} onChange={onChange} />
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">Acres</Typography>
            <TextField fullWidth name="acres" placeholder="00.00" value={formValues.acres} onChange={onChange} />
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
              onChange={onChange}
              SelectProps={{ displayEmpty: true, renderValue: (selected) => selected || 'Select Season' }}
            >
              <MenuItem value="" disabled>
                Select Season
              </MenuItem>
              {seasons.map((season) => (
                <MenuItem key={season} value={season}>
                  {season}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">Water Applied (mm)</Typography>
            <TextField fullWidth name="waterApplied" placeholder="0.00" value={formValues.waterApplied} onChange={onChange} />
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
              onChange={onChange}
              SelectProps={{ displayEmpty: true, renderValue: (selected) => selected || 'Select State' }}
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
            <TextField
              select
              fullWidth
              name="county"
              value={formValues.county}
              onChange={onChange}
              disabled={!formValues.state}
              SelectProps={{ displayEmpty: true, renderValue: (selected) => selected || 'Select County' }}
            >
              <MenuItem value="" disabled>
                Select County
              </MenuItem>
              {counties.map((county) => (
                <MenuItem key={county} value={county}>
                  {county}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </Grid>
      </Grid>
    </Stack>
  );
}
