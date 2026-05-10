import { useEffect, useState } from 'react';

import CloseOutlined from '@ant-design/icons/CloseOutlined';
import DownOutlined from '@ant-design/icons/DownOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';

import YieldDeltaChip from 'sections/intelligence/crop-studio/YieldDeltaChip';
import { formatCropName } from 'utils/cropName';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

function formatNumber(value, decimals = 1) {
  if (value === null || value === undefined || value === '') return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toFixed(decimals);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function getQualityTone(score, theme) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return theme.palette.text.secondary;
  if (score >= 0.8) return theme.palette.success.main;
  if (score >= 0.5) return theme.palette.warning.main;
  return theme.palette.error.main;
}

// Mirror of the helper in FieldTable + Analytics — keep these in sync if you
// add new model families.
function getModelDisplayName(modelType, fallbackTag) {
  const key = String(modelType || '').toLowerCase();
  if (key.includes('deep') || key.includes('pytorch') || key.includes('neural')) return 'Deep Learning';
  if (key.includes('catboost') || key.includes('lgbm') || key.includes('lightgbm') || key.includes('boost')) return 'CatBoost';
  if (key.includes('forest') || key.includes('tree')) return 'Random Forest';
  if (key.includes('xgb')) return 'XGBoost';
  return modelType || fallbackTag || 'Unknown';
}

// Per-model palette so the toggle pill visually distinguishes each model.
// Mirrors the palette in FieldTable.
function getModelChipPalette(modelType, theme) {
  const key = String(modelType || '').toLowerCase();
  if (key.includes('deep') || key.includes('pytorch') || key.includes('neural')) {
    return {
      fg: theme.palette.primary.light,
      bg: alpha(theme.palette.primary.main, 0.18),
      border: alpha(theme.palette.primary.main, 0.5),
      hoverBg: alpha(theme.palette.primary.main, 0.32),
      hoverBorder: theme.palette.primary.main,
      dot: theme.palette.primary.main
    };
  }
  if (key.includes('catboost') || key.includes('lgbm') || key.includes('lightgbm') || key.includes('boost')) {
    return {
      fg: theme.palette.success.light,
      bg: alpha(theme.palette.success.main, 0.18),
      border: alpha(theme.palette.success.main, 0.5),
      hoverBg: alpha(theme.palette.success.main, 0.32),
      hoverBorder: theme.palette.success.main,
      dot: theme.palette.success.main
    };
  }
  if (key.includes('forest') || key.includes('tree')) {
    return {
      fg: theme.palette.info.light,
      bg: alpha(theme.palette.info.main, 0.18),
      border: alpha(theme.palette.info.main, 0.5),
      hoverBg: alpha(theme.palette.info.main, 0.32),
      hoverBorder: theme.palette.info.main,
      dot: theme.palette.info.main
    };
  }
  if (key.includes('xgb')) {
    return {
      fg: theme.palette.warning.light,
      bg: alpha(theme.palette.warning.main, 0.18),
      border: alpha(theme.palette.warning.main, 0.5),
      hoverBg: alpha(theme.palette.warning.main, 0.32),
      hoverBorder: theme.palette.warning.main,
      dot: theme.palette.warning.main
    };
  }
  return {
    fg: theme.palette.primary.light,
    bg: alpha(theme.palette.primary.main, 0.14),
    border: alpha(theme.palette.primary.main, 0.4),
    hoverBg: alpha(theme.palette.primary.main, 0.24),
    hoverBorder: theme.palette.primary.main,
    dot: theme.palette.primary.main
  };
}

function SectionLabel({ children }) {
  const theme = useTheme();
  return (
    <Typography
      sx={{
        color: alpha(theme.palette.primary.light, 0.85),
        fontWeight: 700,
        fontSize: '0.72rem',
        letterSpacing: '0.1em',
        textTransform: 'uppercase'
      }}
    >
      {children}
    </Typography>
  );
}

function InfoField({ label, value, valueColor }) {
  const theme = useTheme();
  return (
    <Stack spacing={0.4}>
      <Typography
        sx={{
          color: alpha(theme.palette.primary.light, 0.7),
          fontWeight: 600,
          fontSize: '0.66rem',
          letterSpacing: '0.08em',
          textTransform: 'uppercase'
        }}
      >
        {label}
      </Typography>
      <Typography sx={{ color: valueColor || theme.palette.common.white, fontWeight: 500, fontSize: '0.9rem' }}>
        {value}
      </Typography>
    </Stack>
  );
}

export default function FieldDetailDrawer({
  fieldSeasonId,
  onClose,
  availableModels = [],
  selectedModelId = null,
  onModelChange = null
}) {
  const theme = useTheme();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  // Anchor for the model-filter Menu in the Predictions section.
  const [modelMenuAnchor, setModelMenuAnchor] = useState(null);

  const open = fieldSeasonId !== null && fieldSeasonId !== undefined;

  useEffect(() => {
    if (!open) {
      setData(null);
      setError('');
      return undefined;
    }

    const controller = new AbortController();
    const load = async () => {
      setIsLoading(true);
      setError('');
      try {
        const response = await fetch(`${API_BASE_URL}/fields/${fieldSeasonId}`, { signal: controller.signal });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to load field detail (${response.status}): ${errorText}`);
        }
        const payload = await response.json();
        setData(payload);
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError(err.message || 'Failed to load field detail.');
          setData(null);
        }
      } finally {
        setIsLoading(false);
      }
    };

    load();
    return () => controller.abort();
  }, [fieldSeasonId, open]);

  const surface = `color-mix(in srgb, ${theme.palette.primary.main} 8%, ${theme.palette.background.paper})`;
  const subtleBorder = alpha(theme.palette.primary.main, 0.22);
  const sectionDivider = alpha(theme.palette.primary.main, 0.18);
  const subtle = alpha(theme.palette.common.white, 0.55);

  const fieldNumber = data?.field?.field_number;
  const cropName = data?.crop?.crop_name_en ? formatCropName(data.crop.crop_name_en) : '—';
  const varietyName = data?.variety?.variety_name_en || '—';
  const seasonYear = data?.season?.season_year ?? '—';
  const observed = data?.yield_bu_ac;
  const target = data?.yield_target;
  const observedNum = Number(observed);
  const targetNum = Number(target);
  const yieldGap =
    Number.isFinite(observedNum) && Number.isFinite(targetNum) && targetNum > 0
      ? ((observedNum - targetNum) / targetNum) * 100
      : null;
  const qualityScore = data?.data_quality_score;
  const missingFlags =
    data?.missing_data_flags && typeof data.missing_data_flags === 'object'
      ? Object.entries(data.missing_data_flags).filter(([, v]) => v)
      : [];

  const events = Array.isArray(data?.management_events) ? data.management_events : [];
  const allPredictions = Array.isArray(data?.predictions) ? data.predictions : [];
  // Always filter to the user's selected model — FieldTable guarantees there
  // is one (auto-selecting production on first load) so the drawer matches
  // what the user is looking at in the table behind it.
  const predictions =
    selectedModelId === null || selectedModelId === undefined
      ? allPredictions
      : allPredictions.filter((p) => p?.model_version?.model_version_id === selectedModelId);
  const selectedModel = availableModels.find((m) => m.model_version_id === selectedModelId) || null;
  const modelLabel = selectedModel
    ? getModelDisplayName(selectedModel.model_type, selectedModel.version_tag)
    : 'Select model';
  const modelPalette = getModelChipPalette(selectedModel?.model_type, theme);

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: 540 },
          bgcolor: theme.palette.background.default,
          backgroundImage: 'none',
          borderLeft: `1px solid ${subtleBorder}`
        }
      }}
    >
      {/* Header */}
      <Stack
        direction="row"
        sx={{
          px: 2.5,
          py: 1.75,
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${sectionDivider}`,
          bgcolor: surface
        }}
      >
        <Stack spacing={0.25}>
          <Typography
            sx={{
              color: alpha(theme.palette.primary.light, 0.85),
              fontWeight: 700,
              fontSize: '0.7rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase'
            }}
          >
            Field Detail
          </Typography>
          <Typography sx={{ color: theme.palette.common.white, fontWeight: 700, fontSize: '1.1rem' }}>
            {fieldNumber ? `Field ${fieldNumber}` : `Record #${fieldSeasonId ?? ''}`}
          </Typography>
        </Stack>
        <IconButton
          size="small"
          aria-label="Close field detail"
          onClick={onClose}
          sx={{
            color: alpha(theme.palette.common.white, 0.75),
            '&:hover': { color: theme.palette.common.white, bgcolor: alpha(theme.palette.primary.main, 0.16) }
          }}
        >
          <CloseOutlined />
        </IconButton>
      </Stack>

      {isLoading ? <LinearProgress /> : null}

      {/* Body */}
      <Box sx={{ p: 2.5, overflowY: 'auto', flex: 1 }}>
        {error ? (
          <Typography sx={{ color: theme.palette.error.main }}>{error}</Typography>
        ) : isLoading && !data ? (
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 4, justifyContent: 'center' }}>
            <CircularProgress size={20} />
            <Typography sx={{ color: subtle }}>Loading field detail…</Typography>
          </Stack>
        ) : data ? (
          <Stack spacing={2.75}>
            {/* Identity chips */}
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              <Chip
                label={`Crop: ${cropName}`}
                sx={{
                  bgcolor: alpha(theme.palette.primary.main, 0.18),
                  color: theme.palette.primary.light,
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.45)}`,
                  borderRadius: 999,
                  fontWeight: 600
                }}
              />
              <Chip
                label={`Variety: ${varietyName}`}
                sx={{
                  bgcolor: 'transparent',
                  color: alpha(theme.palette.common.white, 0.85),
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.4)}`,
                  borderRadius: 999
                }}
              />
              <Chip
                label={`Season: ${seasonYear}`}
                sx={{
                  bgcolor: 'transparent',
                  color: alpha(theme.palette.common.white, 0.85),
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.4)}`,
                  borderRadius: 999
                }}
              />
            </Stack>

            {/* Field metadata */}
            <Stack spacing={1.25}>
              <SectionLabel>Field</SectionLabel>
              <Box
                sx={{
                  bgcolor: surface,
                  border: `1px solid ${subtleBorder}`,
                  borderRadius: 2,
                  p: 2,
                  backgroundImage: 'none'
                }}
              >
                <Grid container spacing={2}>
                  <Grid size={{ xs: 6 }}>
                    <InfoField label="Acres" value={formatNumber(data?.field?.acres, 2)} />
                  </Grid>
                  <Grid size={{ xs: 6 }}>
                    <InfoField
                      label="Location"
                      value={
                        [data?.field?.county, data?.field?.state].filter(Boolean).join(', ') || '—'
                      }
                    />
                  </Grid>
                  <Grid size={{ xs: 6 }}>
                    <InfoField label="Latitude" value={formatNumber(data?.field?.lat, 5)} />
                  </Grid>
                  <Grid size={{ xs: 6 }}>
                    <InfoField label="Longitude" value={formatNumber(data?.field?.long, 5)} />
                  </Grid>
                  {data?.field?.grower_id ? (
                    <Grid size={{ xs: 12 }}>
                      <InfoField label="Grower ID" value={data.field.grower_id} />
                    </Grid>
                  ) : null}
                </Grid>
              </Box>
            </Stack>

            {/* Yield + target */}
            <Stack spacing={1.25}>
              <SectionLabel>Yield</SectionLabel>
              <Box sx={{ bgcolor: surface, border: `1px solid ${subtleBorder}`, borderRadius: 2, p: 2 }}>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 4 }}>
                    <InfoField
                      label="Observed"
                      value={
                        Number.isFinite(observedNum) ? `${formatNumber(observedNum)} bu/ac` : '—'
                      }
                      valueColor={Number.isFinite(observedNum) ? theme.palette.success.main : undefined}
                    />
                  </Grid>
                  <Grid size={{ xs: 4 }}>
                    <InfoField
                      label="Target"
                      value={
                        Number.isFinite(targetNum) ? `${formatNumber(targetNum)} bu/ac` : '—'
                      }
                    />
                  </Grid>
                  <Grid size={{ xs: 4 }}>
                    <InfoField
                      label="vs Target"
                      value={
                        yieldGap !== null
                          ? `${yieldGap >= 0 ? '+' : ''}${yieldGap.toFixed(0)}%`
                          : '—'
                      }
                      valueColor={
                        yieldGap === null
                          ? undefined
                          : yieldGap >= 0
                            ? theme.palette.success.main
                            : theme.palette.error.main
                      }
                    />
                  </Grid>
                </Grid>
              </Box>
            </Stack>

            {/* Nutrient inputs */}
            <Stack spacing={1.25}>
              <SectionLabel>Nutrient Inputs</SectionLabel>
              <Box sx={{ bgcolor: surface, border: `1px solid ${subtleBorder}`, borderRadius: 2, p: 2 }}>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 4 }}>
                    <InfoField
                      label="N (lb/ac)"
                      value={formatNumber(data?.totalN_per_ac)}
                      valueColor={alpha(theme.palette.info.light, 0.95)}
                    />
                  </Grid>
                  <Grid size={{ xs: 4 }}>
                    <InfoField
                      label="P (lb/ac)"
                      value={formatNumber(data?.totalP_per_ac)}
                      valueColor={alpha(theme.palette.warning.light, 0.95)}
                    />
                  </Grid>
                  <Grid size={{ xs: 4 }}>
                    <InfoField
                      label="K (lb/ac)"
                      value={formatNumber(data?.totalK_per_ac)}
                      valueColor={alpha(theme.palette.error.light, 0.95)}
                    />
                  </Grid>
                </Grid>
              </Box>
            </Stack>

            {/* Data quality */}
            <Stack spacing={1.25}>
              <SectionLabel>Data Quality</SectionLabel>
              <Box sx={{ bgcolor: surface, border: `1px solid ${subtleBorder}`, borderRadius: 2, p: 2 }}>
                <Stack spacing={1.25}>
                  <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                    <InfoField
                      label="Score"
                      value={
                        typeof qualityScore === 'number'
                          ? `${(qualityScore * 100).toFixed(0)}/100`
                          : '—'
                      }
                      valueColor={getQualityTone(qualityScore, theme)}
                    />
                    <InfoField label="Source" value={data?.record_source || '—'} />
                  </Stack>
                  {missingFlags.length > 0 ? (
                    <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                      {missingFlags.map(([key]) => (
                        <Chip
                          key={key}
                          size="small"
                          label={`Missing: ${key}`}
                          sx={{
                            bgcolor: alpha(theme.palette.warning.main, 0.15),
                            color: theme.palette.warning.light,
                            border: `1px solid ${alpha(theme.palette.warning.main, 0.4)}`,
                            fontSize: '0.68rem',
                            height: 20
                          }}
                        />
                      ))}
                    </Stack>
                  ) : null}
                </Stack>
              </Box>
            </Stack>

            {/* Predictions history */}
            <Stack spacing={1.25}>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                <SectionLabel>Predictions ({predictions.length})</SectionLabel>
                {availableModels.length > 0 && onModelChange ? (
                  <>
                    <Button
                      size="small"
                      onClick={(event) => setModelMenuAnchor(event.currentTarget)}
                      endIcon={<DownOutlined style={{ fontSize: '0.7rem' }} />}
                      sx={{
                        textTransform: 'none',
                        fontWeight: 600,
                        fontSize: '0.7rem',
                        letterSpacing: '0.02em',
                        minHeight: 0,
                        whiteSpace: 'nowrap',
                        py: 0.25,
                        px: 1.25,
                        borderRadius: 999,
                        color: modelPalette.fg,
                        bgcolor: modelPalette.bg,
                        border: `1px solid ${modelPalette.border}`,
                        transition: 'background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease',
                        '&:hover': {
                          // Explicit light color so the label stays bright on the
                          // tinted hover background instead of resolving darker.
                          color: theme.palette.common.white,
                          bgcolor: modelPalette.hoverBg,
                          borderColor: modelPalette.hoverBorder,
                          boxShadow: `0 0 0 2px ${alpha(modelPalette.dot, 0.18)}`
                        }
                      }}
                    >
                      {modelLabel}
                    </Button>
                    <Menu
                      anchorEl={modelMenuAnchor}
                      open={Boolean(modelMenuAnchor)}
                      onClose={() => setModelMenuAnchor(null)}
                      slotProps={{
                        paper: {
                          sx: {
                            bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 8%, ${theme.palette.background.paper})`,
                            border: `1px solid ${alpha(theme.palette.primary.main, 0.32)}`,
                            borderRadius: 1.25,
                            backgroundImage: 'none',
                            mt: 0.5,
                            '& .MuiMenuItem-root': {
                              color: alpha(theme.palette.common.white, 0.88),
                              fontSize: '0.85rem',
                              minHeight: 32,
                              '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.16) },
                              '&.Mui-selected': {
                                bgcolor: alpha(theme.palette.primary.main, 0.24),
                                '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.32) }
                              }
                            }
                          }
                        }
                      }}
                    >
                      {availableModels.map((model) => {
                        const itemPalette = getModelChipPalette(model.model_type, theme);
                        return (
                          <MenuItem
                            key={model.model_version_id}
                            selected={selectedModelId === model.model_version_id}
                            onClick={() => {
                              onModelChange(model.model_version_id);
                              setModelMenuAnchor(null);
                            }}
                          >
                            <Box
                              component="span"
                              sx={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                bgcolor: itemPalette.dot,
                                mr: 1.25,
                                display: 'inline-block',
                                flexShrink: 0
                              }}
                            />
                            {getModelDisplayName(model.model_type, model.version_tag)}
                          </MenuItem>
                        );
                      })}
                    </Menu>
                  </>
                ) : null}
              </Stack>
              <Box sx={{ bgcolor: surface, border: `1px solid ${subtleBorder}`, borderRadius: 2, p: 2 }}>
                {predictions.length === 0 ? (
                  <Typography sx={{ color: subtle, fontSize: '0.85rem' }}>
                    No predictions stored for this field-season yet.
                  </Typography>
                ) : (
                  <Stack divider={<Divider flexItem sx={{ borderColor: sectionDivider }} />} spacing={1.25}>
                    {predictions.map((pred) => (
                      <Stack key={pred.prediction_id} spacing={0.5}>
                        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                            <Typography sx={{ color: theme.palette.common.white, fontWeight: 600, fontSize: '0.9rem' }}>
                              {formatNumber(pred.predicted_yield)} bu/ac
                            </Typography>
                            <YieldDeltaChip predicted={pred.predicted_yield} observed={data?.yield_bu_ac} />
                          </Stack>
                          <Typography sx={{ color: subtle, fontSize: '0.78rem' }}>
                            {formatDateTime(pred.created_at)}
                          </Typography>
                        </Stack>
                        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, rowGap: 0.5 }}>
                          <Typography sx={{ color: subtle, fontSize: '0.78rem' }}>
                            CI: [{formatNumber(pred.confidence_lower)}–{formatNumber(pred.confidence_upper)}]
                          </Typography>
                          {pred.regional_avg_yield != null ? (
                            <Typography sx={{ color: subtle, fontSize: '0.78rem' }}>
                              · Regional avg: {formatNumber(pred.regional_avg_yield)}
                            </Typography>
                          ) : null}
                          {pred.model_version ? (
                            <Typography sx={{ color: subtle, fontSize: '0.78rem' }}>
                              · {pred.model_version.model_type || pred.model_version.version_tag}
                            </Typography>
                          ) : null}
                        </Stack>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </Box>
            </Stack>

            {/* Management timeline */}
            <Stack spacing={1.25}>
              <SectionLabel>Management Events ({events.length})</SectionLabel>
              <Box sx={{ bgcolor: surface, border: `1px solid ${subtleBorder}`, borderRadius: 2, p: 2 }}>
                {events.length === 0 ? (
                  <Typography sx={{ color: subtle, fontSize: '0.85rem' }}>
                    No management events recorded for this field-season.
                  </Typography>
                ) : (
                  <Stack divider={<Divider flexItem sx={{ borderColor: sectionDivider }} />} spacing={1.5}>
                    {events.map((ev) => (
                      <Stack key={ev.event_id} spacing={0.5}>
                        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 1 }}>
                          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                            <Chip
                              size="small"
                              label={ev.event_type || 'event'}
                              sx={{
                                bgcolor: alpha(theme.palette.primary.main, 0.18),
                                color: theme.palette.primary.light,
                                border: `1px solid ${alpha(theme.palette.primary.main, 0.4)}`,
                                fontSize: '0.7rem',
                                height: 22,
                                fontWeight: 600
                              }}
                            />
                            {ev.status ? (
                              <Typography sx={{ color: subtle, fontSize: '0.75rem' }}>{ev.status}</Typography>
                            ) : null}
                          </Stack>
                          <Typography sx={{ color: subtle, fontSize: '0.78rem' }}>
                            {formatDate(ev.start_date)}
                            {ev.end_date && ev.end_date !== ev.start_date ? ` – ${formatDate(ev.end_date)}` : ''}
                          </Typography>
                        </Stack>
                        {(ev.description || ev.chem_product || ev.blend_name || ev.fertilizer_id) ? (
                          <Typography sx={{ color: alpha(theme.palette.common.white, 0.8), fontSize: '0.85rem' }}>
                            {ev.description || ev.chem_product || ev.blend_name || ev.fertilizer_id}
                          </Typography>
                        ) : null}
                        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.25, rowGap: 0.4, color: subtle, fontSize: '0.75rem' }}>
                          {ev.amount != null ? <span>Amount: {formatNumber(ev.amount, 2)}{ev.fert_units ? ` ${ev.fert_units}` : ''}</span> : null}
                          {ev.rate != null ? <span>Rate: {formatNumber(ev.rate, 2)}</span> : null}
                          {ev.application_area != null ? <span>Area: {formatNumber(ev.application_area, 2)}</span> : null}
                          {ev.water_applied_mm != null ? <span>Water: {formatNumber(ev.water_applied_mm, 1)} mm</span> : null}
                          {ev.irrigation_method ? <span>{ev.irrigation_method}</span> : null}
                          {ev.machine_make1 ? <span>Machine: {ev.machine_make1}{ev.machine_model1 ? ` ${ev.machine_model1}` : ''}</span> : null}
                        </Stack>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </Box>
            </Stack>
          </Stack>
        ) : null}
      </Box>
    </Drawer>
  );
}
