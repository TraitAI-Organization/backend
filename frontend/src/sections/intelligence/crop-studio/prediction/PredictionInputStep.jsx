import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';

import { formatCropName } from 'utils/cropName';

// Field label component — small uppercase caption tinted to the primary
// family, mirroring the InfoField pattern in ModelSelectionStep so the
// two wizard steps read as one cohesive form. Required fields get a
// red asterisk after the text; optional fields don't.
function FieldLabel({ text, required = false }) {
  const theme = useTheme();
  return (
    <Typography
      sx={{
        color: alpha(theme.palette.primary.light, 0.85),
        fontSize: '0.7rem',
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        lineHeight: 1.3
      }}
    >
      {text}
      {required ? (
        <Box
          component="span"
          aria-hidden
          sx={{ color: theme.palette.error.light, ml: 0.4, fontSize: '0.85rem' }}
        >
          *
        </Box>
      ) : null}
    </Typography>
  );
}

// Section header — slightly more prominent than the field labels so the
// form parses as discrete groups (Crop & Variety / Field Inputs / Time
// & Location) rather than 9 unrelated text fields.
function SectionHeader({ children }) {
  const theme = useTheme();
  return (
    <Typography
      sx={{
        color: alpha(theme.palette.primary.light, 0.95),
        fontSize: '0.8rem',
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase'
      }}
    >
      {children}
    </Typography>
  );
}

export default function PredictionInputStep({ formValues, onChange, crops, varieties, seasons, states, counties, validationErrors = {} }) {
  const theme = useTheme();
  const hasCrop = Boolean(formValues.crop);
  const hasVarietiesForCrop = varieties.length > 0;
  const isVarietyDisabled = !hasCrop || !hasVarietiesForCrop;

  // Surface tokens matched to the Overview tab's metric-tile family:
  // bright primary-tinted bg with a half-alpha primary border + soft
  // drop shadow. Previously this step used a darker `color-mix(8%
  // primary, paper)` surface which read as muted navy and felt visually
  // disconnected from the rest of the page. Aligning to the Overview
  // tile values makes every primary-blue surface in the app one family.
  const cardSurface = alpha(theme.palette.primary.main, 0.18);
  const cardBorder = alpha(theme.palette.primary.main, 0.5);
  const cardShadow = `0 4px 14px ${alpha(theme.palette.common.black, 0.35)}`;
  // Themed dropdown menu surface — uses the slightly darker color-mix
  // tone so opened menus are visibly distinct from the bright Paper
  // they sit over. Matches the dropdown styling on FieldMapPreview's
  // hover popup and the FieldTable's column-header area.
  const menuSurface = `color-mix(in srgb, ${theme.palette.primary.main} 14%, ${theme.palette.background.paper})`;
  const sectionDivider = alpha(theme.palette.primary.main, 0.28);
  const headingColor = theme.palette.common.white;
  const labelMuted = alpha(theme.palette.common.white, 0.65);

  // Themed TextField styling — primary-tinted bg, primary-alpha borders,
  // primary on focus + hover. Mirrors the FieldTable filter inputs and
  // the wizard's other styled inputs so any text input on the page
  // looks like it belongs to the same product surface.
  const themedFieldSx = {
    '& .MuiOutlinedInput-root': {
      // Light, neutral-tinted fill — uses a low-alpha WHITE overlay
      // (not primary-tinted) so the inputs visually lift off the
      // brighter primary-blue Paper around them. Previously the
      // inputs were primary-tinted at alpha 0.08 which read as
      // *darker* than the Paper (less primary tint than 0.18 = less
      // blue = darker rendered color in dark mode); switching to a
      // white tint makes them clearly lighter / more "raised."
      bgcolor: alpha(theme.palette.common.white, 0.08),
      color: theme.palette.common.white,
      fontSize: '0.92rem',
      borderRadius: 1.25,
      transition: 'background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease',
      '& fieldset': { borderColor: alpha(theme.palette.primary.light, 0.35) },
      '&:hover': { bgcolor: alpha(theme.palette.common.white, 0.12) },
      '&:hover fieldset': { borderColor: alpha(theme.palette.primary.light, 0.6) },
      '&.Mui-focused': {
        bgcolor: alpha(theme.palette.common.white, 0.14)
      },
      '&.Mui-focused fieldset': {
        borderColor: theme.palette.primary.light,
        borderWidth: 1.5,
        boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.22)}`
      },
      '&.Mui-disabled': {
        bgcolor: alpha(theme.palette.common.white, 0.04)
      },
      '&.Mui-disabled fieldset': { borderColor: alpha(theme.palette.primary.main, 0.16) },
      '&.Mui-error fieldset': { borderColor: theme.palette.error.main }
    },
    '& .MuiInputBase-input': {
      // Number-input arrow controls hidden in webkit and firefox so the
      // numeric fields read as clean text inputs (matching the rest of
      // the form's pill-style geometry).
      '&[type=number]': {
        MozAppearance: 'textfield'
      },
      '&[type=number]::-webkit-outer-spin-button, &[type=number]::-webkit-inner-spin-button': {
        WebkitAppearance: 'none',
        margin: 0
      }
    },
    // Placeholder text is white at full strength when the field is
    // editable — reads as a clear hint instead of the faded grey
    // browser default. `opacity: 1` overrides Firefox's built-in 0.54
    // dimming. The disabled-state override below pulls it back to
    // muted grey so a non-editable field still looks non-editable.
    '& .MuiInputBase-input::placeholder': {
      color: theme.palette.common.white,
      opacity: 1
    },
    // Disabled state — input value AND placeholder both render in the
    // theme's muted-grey palette. We have to set BOTH `color` and
    // `WebkitTextFillColor`: Chrome/Safari paint disabled-input text
    // via WebkitTextFillColor regardless of the `color` property, so
    // omitting it would leave the value at full white while the
    // placeholder dimmed (inconsistent).
    '& .MuiInputBase-input.Mui-disabled': {
      WebkitTextFillColor: alpha(theme.palette.common.white, 0.45),
      color: alpha(theme.palette.common.white, 0.45)
    },
    '& .MuiInputBase-input.Mui-disabled::placeholder': {
      color: alpha(theme.palette.common.white, 0.4),
      WebkitTextFillColor: alpha(theme.palette.common.white, 0.4),
      opacity: 1
    },
    // Select-flavored fields (Crop / Variety / Season / State /
    // County) render their empty-state hint via `renderValue` rather
    // than a real HTML placeholder, so the rule above doesn't reach
    // it. This rule disables the select's display element when the
    // wrapping FormControl is disabled — same muted-grey result.
    '& .MuiInputBase-root.Mui-disabled .MuiSelect-select': {
      WebkitTextFillColor: alpha(theme.palette.common.white, 0.45),
      color: alpha(theme.palette.common.white, 0.45)
    },
    '& .MuiSelect-icon': { color: alpha(theme.palette.primary.light, 0.75) },
    '& .MuiFormHelperText-root': {
      color: alpha(theme.palette.common.white, 0.55),
      fontSize: '0.72rem',
      mx: 0.25
    },
    '& .MuiFormHelperText-root.Mui-error': { color: theme.palette.error.light }
  };

  // Themed dropdown menu so opened menus pick up the same primary-on-
  // paper surface as the rest of the page. Without this, MUI defaults
  // render a plain gray panel that breaks the visual continuity.
  const themedSelectMenuProps = {
    MenuProps: {
      slotProps: {
        paper: {
          sx: {
            bgcolor: menuSurface,
            border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
            backgroundImage: 'none',
            mt: 0.5,
            maxHeight: 320,
            '& .MuiMenuItem-root': {
              color: alpha(theme.palette.common.white, 0.9),
              fontSize: '0.9rem',
              minHeight: 36,
              '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.18) },
              '&.Mui-selected': {
                bgcolor: alpha(theme.palette.primary.main, 0.32),
                '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.42) }
              }
            }
          }
        }
      }
    }
  };

  return (
    <Stack spacing={2.75}>
      {/* Header — matches the heading typography in ModelSelectionStep
          so both wizard steps share the same opening rhythm. */}
      <Stack spacing={0.5}>
        <Typography variant="h4" sx={{ fontWeight: 700, color: headingColor, lineHeight: 1.2 }}>
          Enter Prediction Inputs
        </Typography>
        <Typography sx={{ color: labelMuted, fontSize: '0.95rem', maxWidth: 760, lineHeight: 1.55 }}>
          Provide the agronomic and location values used to generate a yield prediction. Optional numeric inputs may be left blank — entering
          0 is also allowed.
        </Typography>
      </Stack>

      <Paper
        variant="outlined"
        sx={{
          bgcolor: cardSurface,
          borderColor: cardBorder,
          borderRadius: 2,
          p: { xs: 2.25, md: 3 },
          backgroundImage: 'none',
          boxShadow: cardShadow
        }}
      >
        <Stack spacing={3}>
          {/* Section 1 — Crop & Variety. Both required, both drive the
              prediction's reference distribution, so they lead the form. */}
          <Stack spacing={1.75}>
            <SectionHeader>Crop & Variety</SectionHeader>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Stack spacing={0.85}>
                  <FieldLabel text="Crop" required />
                  <TextField
                    select
                    fullWidth
                    name="crop"
                    value={formValues.crop}
                    onChange={onChange}
                    error={Boolean(validationErrors.crop)}
                    helperText={validationErrors.crop ? 'Crop is required.' : undefined}
                    sx={themedFieldSx}
                    SelectProps={{
                      displayEmpty: true,
                      renderValue: (selected) => (selected ? formatCropName(selected) : 'Select a crop…'),
                      ...themedSelectMenuProps
                    }}
                  >
                    <MenuItem value="" disabled>
                      Select a crop…
                    </MenuItem>
                    {crops.map((crop) => (
                      <MenuItem key={crop} value={crop}>
                        {formatCropName(crop)}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <Stack spacing={0.85}>
                  <FieldLabel text="Variety" required />
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
                    sx={themedFieldSx}
                    SelectProps={{
                      displayEmpty: true,
                      renderValue: (selected) => selected || 'Select a variety…',
                      ...themedSelectMenuProps
                    }}
                  >
                    <MenuItem value="" disabled>
                      Select a variety…
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
            </Grid>
          </Stack>

          <Divider sx={{ borderColor: sectionDivider }} />

          {/* Section 2 — Field Inputs. Numeric agronomic data: nutrient
              applications, area, irrigation. All optional — entering 0
              is meaningful (vs. blank, which means "unknown"). */}
          <Stack spacing={1.75}>
            <SectionHeader>Field Inputs</SectionHeader>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <Stack spacing={0.85}>
                  <FieldLabel text="Total N (lb/ac)" />
                  <TextField
                    fullWidth
                    type="number"
                    name="totalN"
                    placeholder="0.00"
                    value={formValues.totalN}
                    onChange={onChange}
                    sx={themedFieldSx}
                  />
                </Stack>
              </Grid>

              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <Stack spacing={0.85}>
                  <FieldLabel text="Total P (lb/ac)" />
                  <TextField
                    fullWidth
                    type="number"
                    name="totalP"
                    placeholder="0.00"
                    value={formValues.totalP}
                    onChange={onChange}
                    sx={themedFieldSx}
                  />
                </Stack>
              </Grid>

              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <Stack spacing={0.85}>
                  <FieldLabel text="Total K (lb/ac)" />
                  <TextField
                    fullWidth
                    type="number"
                    name="totalK"
                    placeholder="0.00"
                    value={formValues.totalK}
                    onChange={onChange}
                    sx={themedFieldSx}
                  />
                </Stack>
              </Grid>

              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <Stack spacing={0.85}>
                  <FieldLabel text="Acres" />
                  <TextField
                    fullWidth
                    type="number"
                    name="acres"
                    placeholder="0.00"
                    value={formValues.acres}
                    onChange={onChange}
                    sx={themedFieldSx}
                  />
                </Stack>
              </Grid>

              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <Stack spacing={0.85}>
                  <FieldLabel text="Water Applied (mm)" />
                  <TextField
                    fullWidth
                    type="number"
                    name="waterApplied"
                    placeholder="0.00"
                    value={formValues.waterApplied}
                    onChange={onChange}
                    sx={themedFieldSx}
                  />
                </Stack>
              </Grid>
            </Grid>
          </Stack>

          <Divider sx={{ borderColor: sectionDivider }} />

          {/* Section 3 — Time & Location. Season + geographic context.
              All required: the model uses these to scope its reference
              comparison to the right region/year. */}
          <Stack spacing={1.75}>
            <SectionHeader>Time & Location</SectionHeader>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <Stack spacing={0.85}>
                  <FieldLabel text="Season" required />
                  <TextField
                    select
                    fullWidth
                    name="season"
                    value={formValues.season}
                    onChange={onChange}
                    error={Boolean(validationErrors.season)}
                    helperText={validationErrors.season ? 'Season is required.' : undefined}
                    sx={themedFieldSx}
                    SelectProps={{
                      displayEmpty: true,
                      renderValue: (selected) => selected || 'Select season',
                      ...themedSelectMenuProps
                    }}
                  >
                    <MenuItem value="" disabled>
                      Select season
                    </MenuItem>
                    {seasons.map((season) => (
                      <MenuItem key={season} value={season}>
                        {season}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
              </Grid>

              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <Stack spacing={0.85}>
                  <FieldLabel text="State" required />
                  <TextField
                    select
                    fullWidth
                    name="state"
                    value={formValues.state}
                    onChange={onChange}
                    error={Boolean(validationErrors.state)}
                    helperText={validationErrors.state ? 'State is required.' : undefined}
                    sx={themedFieldSx}
                    SelectProps={{
                      displayEmpty: true,
                      renderValue: (selected) => selected || 'Select state',
                      ...themedSelectMenuProps
                    }}
                  >
                    <MenuItem value="" disabled>
                      Select state
                    </MenuItem>
                    {states.map((state) => (
                      <MenuItem key={state} value={state}>
                        {state}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
              </Grid>

              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <Stack spacing={0.85}>
                  <FieldLabel text="County" required />
                  <TextField
                    select
                    fullWidth
                    name="county"
                    value={formValues.county}
                    onChange={onChange}
                    disabled={!formValues.state}
                    error={Boolean(validationErrors.county)}
                    helperText={
                      validationErrors.county
                        ? 'County is required.'
                        : !formValues.state
                          ? 'Select a state first'
                          : undefined
                    }
                    sx={themedFieldSx}
                    SelectProps={{
                      displayEmpty: true,
                      renderValue: (selected) => selected || 'Select county',
                      ...themedSelectMenuProps
                    }}
                  >
                    <MenuItem value="" disabled>
                      Select county
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
        </Stack>
      </Paper>
    </Stack>
  );
}
