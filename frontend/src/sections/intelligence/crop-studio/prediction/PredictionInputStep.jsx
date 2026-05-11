import { useEffect, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';

import HistoryOutlined from '@ant-design/icons/HistoryOutlined';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';

import { formatCropName } from 'utils/cropName';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

// Coerce numeric API values (number | null | undefined) into the string
// representation the form's controlled inputs expect. Empty string means
// "no value", which is what the form treats as a cleared field.
function numToFormString(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : '';
}

// Compact one-line summary of a saved run, used as the dropdown menu item
// label. Order is "crop · variety · season · state · county" so the bits
// that matter most for distinguishing runs (crop and season) lead.
function summarizePrefillRun(run) {
  if (!run) return '';
  const parts = [];
  if (run.crop) parts.push(formatCropName(run.crop));
  if (run.variety) parts.push(run.variety);
  if (run.season != null && run.season !== '') parts.push(String(run.season));
  const loc = [run.state, run.county].filter(Boolean).join(', ');
  if (loc) parts.push(loc);
  return parts.join(' · ');
}

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

export default function PredictionInputStep({
  formValues,
  onChange,
  onPrefill,
  crops,
  varieties,
  seasons,
  states,
  counties,
  validationErrors = {}
}) {
  const theme = useTheme();
  const hasCrop = Boolean(formValues.crop);
  const hasVarietiesForCrop = varieties.length > 0;
  const isVarietyDisabled = !hasCrop || !hasVarietiesForCrop;

  // Saved prediction runs the user can prefill from. Same /predict/history
  // endpoint Analytics uses; pulled to a generous 50 entries so users with a
  // moderate run history see most of their work without paging. Failures are
  // silent — the banner just hides when the list is empty, so a broken
  // endpoint never blocks the manual form path.
  const [prefillRuns, setPrefillRuns] = useState([]);
  const [selectedPrefillId, setSelectedPrefillId] = useState('');
  const [prefillLoadError, setPrefillLoadError] = useState('');

  useEffect(() => {
    if (typeof onPrefill !== 'function') return undefined;
    const controller = new AbortController();
    const loadHistory = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/predict/history?limit=50&page=1`, { signal: controller.signal });
        if (!response.ok) {
          setPrefillLoadError('Could not load previous runs.');
          return;
        }
        const payload = await response.json();
        const rows = Array.isArray(payload) ? payload : [];
        // Map the API row into the shape this component needs. We pull
        // canonical column names first and fall back to the request payload
        // so older rows missing the flat columns still resolve. Numeric
        // fields are coerced into strings (the form's controlled inputs
        // hold strings, not numbers) via numToFormString.
        const normalized = rows
          .map((row) => {
            const req = row.request_payload || {};
            return {
              id: row.prediction_run_id,
              createdAt: row.created_at,
              crop: row.crop || req.crop || '',
              variety: row.variety || req.variety || '',
              season: row.season ?? req.season ?? '',
              state: row.state || req.state || '',
              county: row.county || req.county || '',
              acres: numToFormString(row.acres ?? req.acres),
              totalN: numToFormString(row.totalN_per_ac ?? req.totalN_per_ac),
              totalP: numToFormString(row.totalP_per_ac ?? req.totalP_per_ac),
              totalK: numToFormString(row.totalK_per_ac ?? req.totalK_per_ac),
              waterApplied: numToFormString(row.water_applied_mm ?? req.water_applied_mm)
            };
          })
          .filter((row) => row.id != null);
        setPrefillRuns(normalized);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setPrefillLoadError(error.message || 'Could not load previous runs.');
        }
      }
    };
    loadHistory();
    return () => controller.abort();
  }, [onPrefill]);

  const selectedPrefillRun = useMemo(
    () => prefillRuns.find((r) => String(r.id) === String(selectedPrefillId)) || null,
    [prefillRuns, selectedPrefillId]
  );

  const handleApplyPrefill = () => {
    if (!selectedPrefillRun || typeof onPrefill !== 'function') return;
    const { id: _id, createdAt: _createdAt, ...patch } = selectedPrefillRun;
    onPrefill(patch);
  };

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

      {/* Prefill banner — optional shortcut that lets the user jump-start
          the form with a previous run's values. Hidden when no runs are
          available so the form path is unaffected for first-time users. */}
      {prefillRuns.length > 0 ? (
        <Paper
          variant="outlined"
          sx={{
            // Slightly cooler tint than the main form card so the banner
            // reads as a secondary affordance, not a duplicate primary panel.
            bgcolor: alpha(theme.palette.primary.main, 0.14),
            borderColor: alpha(theme.palette.primary.main, 0.45),
            borderRadius: 2,
            backgroundImage: 'none',
            boxShadow: cardShadow,
            overflow: 'hidden'
          }}
        >
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={{ xs: 1.5, md: 2 }}
            sx={{
              alignItems: { xs: 'stretch', md: 'center' },
              px: { xs: 2, md: 2.5 },
              py: 1.75
            }}
          >
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flex: 1, minWidth: 0 }}>
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: alpha(theme.palette.primary.main, 0.25),
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.55)}`,
                  color: theme.palette.primary.light,
                  fontSize: '1.05rem',
                  flexShrink: 0
                }}
              >
                <HistoryOutlined />
              </Box>
              <Stack spacing={0.15} sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
                  <Typography
                    sx={{
                      color: theme.palette.common.white,
                      fontWeight: 700,
                      fontSize: '0.92rem',
                      letterSpacing: '0.02em'
                    }}
                  >
                    Prefill from a previous run
                  </Typography>
                  <Tooltip
                    arrow
                    placement="top"
                    title="Copies crop, variety, season, location, and applied inputs from the selected run into the form below. You can still edit any field after prefilling."
                    slotProps={{
                      tooltip: {
                        sx: {
                          bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})`,
                          color: theme.palette.common.white,
                          border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
                          fontSize: '0.74rem',
                          fontWeight: 500,
                          maxWidth: 300,
                          px: 1.25,
                          py: 0.85,
                          borderRadius: 1.25
                        }
                      },
                      arrow: {
                        sx: { color: `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})` }
                      }
                    }}
                  >
                    <Box
                      component="span"
                      tabIndex={0}
                      aria-label="About prefilling"
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        cursor: 'help',
                        color: alpha(theme.palette.primary.light, 0.7),
                        fontSize: '0.85rem',
                        '&:hover, &:focus-visible': { color: theme.palette.primary.light, outline: 'none' }
                      }}
                    >
                      <InfoCircleOutlined />
                    </Box>
                  </Tooltip>
                </Stack>
                <Typography
                  sx={{
                    color: alpha(theme.palette.common.white, 0.6),
                    fontSize: '0.78rem',
                    fontWeight: 500,
                    lineHeight: 1.4
                  }}
                >
                  Optional — pick a saved run to copy its inputs into the form.
                </Typography>
              </Stack>
            </Stack>

            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ width: { xs: '100%', md: 'auto' }, alignItems: { xs: 'stretch', sm: 'center' } }}
            >
              <TextField
                select
                size="small"
                value={selectedPrefillId}
                onChange={(event) => setSelectedPrefillId(event.target.value)}
                sx={{
                  ...themedFieldSx,
                  minWidth: { xs: '100%', sm: 320 },
                  '& .MuiOutlinedInput-root': {
                    ...themedFieldSx['& .MuiOutlinedInput-root'],
                    fontSize: '0.85rem'
                  }
                }}
                SelectProps={{
                  displayEmpty: true,
                  renderValue: (selected) => {
                    if (!selected) {
                      return (
                        <Box component="span" sx={{ color: alpha(theme.palette.common.white, 0.55) }}>
                          Choose a previous run…
                        </Box>
                      );
                    }
                    const run = prefillRuns.find((r) => String(r.id) === String(selected));
                    if (!run) return String(selected);
                    return `#${run.id} · ${summarizePrefillRun(run)}`;
                  },
                  ...themedSelectMenuProps
                }}
              >
                <MenuItem value="" disabled>
                  Choose a previous run…
                </MenuItem>
                {prefillRuns.map((run) => (
                  <MenuItem key={run.id} value={run.id}>
                    <Stack spacing={0.15} sx={{ minWidth: 0 }}>
                      <Typography
                        sx={{
                          color: theme.palette.common.white,
                          fontWeight: 700,
                          fontSize: '0.85rem',
                          lineHeight: 1.25
                        }}
                      >
                        Run #{run.id}
                      </Typography>
                      <Typography
                        sx={{
                          color: alpha(theme.palette.common.white, 0.7),
                          fontSize: '0.76rem',
                          fontWeight: 500,
                          lineHeight: 1.3,
                          whiteSpace: 'normal'
                        }}
                      >
                        {summarizePrefillRun(run) || '—'}
                      </Typography>
                    </Stack>
                  </MenuItem>
                ))}
              </TextField>
              <Button
                disabled={!selectedPrefillRun}
                onClick={handleApplyPrefill}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  letterSpacing: '0.01em',
                  px: 2,
                  py: 0.7,
                  borderRadius: 999,
                  color: alpha(theme.palette.primary.light, 0.95),
                  bgcolor: alpha(theme.palette.primary.main, 0.18),
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.55)}`,
                  transition: 'background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease',
                  whiteSpace: 'nowrap',
                  '&:hover': {
                    color: theme.palette.common.white,
                    bgcolor: alpha(theme.palette.primary.main, 0.32),
                    borderColor: theme.palette.primary.main,
                    boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.18)}`
                  },
                  '&.Mui-disabled': {
                    color: alpha(theme.palette.common.white, 0.4),
                    bgcolor: alpha(theme.palette.primary.main, 0.08),
                    borderColor: alpha(theme.palette.primary.main, 0.2)
                  }
                }}
              >
                Prefill
              </Button>
            </Stack>
          </Stack>
          {prefillLoadError ? (
            <Box
              sx={{
                px: { xs: 2, md: 2.5 },
                py: 1,
                borderTop: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                bgcolor: alpha(theme.palette.warning.main, 0.06)
              }}
            >
              <Typography sx={{ color: theme.palette.warning.light, fontSize: '0.75rem' }}>
                {prefillLoadError}
              </Typography>
            </Box>
          ) : null}
        </Paper>
      ) : null}

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
