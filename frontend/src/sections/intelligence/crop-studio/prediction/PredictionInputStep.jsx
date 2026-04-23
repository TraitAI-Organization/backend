import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

function RequiredLabel({ text }) {
  return (
    <Typography variant="subtitle2">
      {text} <Box component="span" sx={{ color: 'error.main' }}>*</Box>
    </Typography>
  );
}

export default function PredictionInputStep({ formValues, onChange, crops, varieties, seasons, states, counties, validationErrors = {} }) {
  const hasCrop = Boolean(formValues.crop);
  const hasVarietiesForCrop = varieties.length > 0;
  const isVarietyDisabled = !hasCrop || !hasVarietiesForCrop;

  return (
    <Stack spacing={2.5}>
      <Typography variant="h6">Step 2: Enter Prediction Inputs</Typography>
      <Typography variant="body2" color="text.secondary">
        Provide agronomic and location values used to generate a yield prediction. You may leave optional numeric inputs blank; entering
        0 is also allowed.
      </Typography>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Stack spacing={1}>
            <RequiredLabel text="Crop" />
            <TextField
              select
              fullWidth
              name="crop"
              value={formValues.crop}
              onChange={onChange}
              error={Boolean(validationErrors.crop)}
              helperText={validationErrors.crop ? 'Crop is required.' : undefined}
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
            <RequiredLabel text="Variety" />
            <TextField
              select
              fullWidth
              name="variety"
              value={formValues.variety}
              onChange={onChange}
              disabled={isVarietyDisabled}
              error={Boolean(validationErrors.variety)}
              helperText={
                validationErrors.variety
                  ? 'Variety is required.'
                  : hasCrop && !hasVarietiesForCrop
                    ? 'No variety available for selected crop'
                    : undefined
              }
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

        {/* <Grid size={{ xs: 12, md: 6 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">Latitude</Typography>
            <TextField fullWidth type="number" name="latitude" placeholder="00.000" value={formValues.latitude} onChange={onChange} />
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">Longitude</Typography>
            <TextField fullWidth type="number" name="longitude" placeholder="00.00000" value={formValues.longitude} onChange={onChange} />
          </Stack>
        </Grid> */}

        <Grid size={{ xs: 12, md: 6 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">Total N (lb/ac)</Typography>
            <TextField fullWidth type="number" name="totalN" placeholder="00.00" value={formValues.totalN} onChange={onChange} />
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">Total P (lb/ac)</Typography>
            <TextField fullWidth type="number" name="totalP" placeholder="00.00" value={formValues.totalP} onChange={onChange} />
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">Total K (lb/ac)</Typography>
            <TextField fullWidth type="number" name="totalK" placeholder="00.00" value={formValues.totalK} onChange={onChange} />
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">Acres</Typography>
            <TextField fullWidth type="number" name="acres" placeholder="00.00" value={formValues.acres} onChange={onChange} />
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Stack spacing={1}>
            <RequiredLabel text="Season" />
            <TextField
              select
              fullWidth
              name="season"
              value={formValues.season}
              onChange={onChange}
              error={Boolean(validationErrors.season)}
              helperText={validationErrors.season ? 'Season is required.' : undefined}
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
            <TextField fullWidth type="number" name="waterApplied" placeholder="0.00" value={formValues.waterApplied} onChange={onChange} />
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Stack spacing={1}>
            <RequiredLabel text="State" />
            <TextField
              select
              fullWidth
              name="state"
              value={formValues.state}
              onChange={onChange}
              error={Boolean(validationErrors.state)}
              helperText={validationErrors.state ? 'State is required.' : undefined}
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
            <RequiredLabel text="County" />
            <TextField
              select
              fullWidth
              name="county"
              value={formValues.county}
              onChange={onChange}
              disabled={!formValues.state}
              error={Boolean(validationErrors.county)}
              helperText={validationErrors.county ? 'County is required.' : undefined}
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
