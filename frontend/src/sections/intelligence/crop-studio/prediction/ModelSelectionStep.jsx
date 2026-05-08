import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';

function formatTrainingDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString();
}

// Maps a raw model_type string from the API to a human-readable title,
// long-form description, and the relative interpretability / speed
// indicators used by the metric bars on the model card. Anything we don't
// recognize falls back to a neutral profile so the UI still renders.
function getModelMeta(modelType) {
  const key = String(modelType || '').toLowerCase();

  if (key.includes('deep') || key.includes('pytorch') || key.includes('neural')) {
    return {
      title: 'Deep Learning',
      description:
        'A flexible neural network that captures complex, non-linear relationships across many numeric inputs. Performs best when combining spectral, weather, and soil features. Less transparent but highly adaptive to varied field conditions.',
      interpretability: { label: 'Low', percent: 25, tone: 'warning' },
      speed: { label: 'Fast', percent: 78, tone: 'success' }
    };
  }

  if (key.includes('catboost') || key.includes('lgbm') || key.includes('lightgbm') || key.includes('boost')) {
    return {
      title: 'CatBoost',
      description:
        'A gradient boosting model well-suited for categorical and mixed-type inputs like field records and management data. More interpretable and stable — a strong choice for understanding which factors are driving your predictions.',
      interpretability: { label: 'High', percent: 88, tone: 'success' },
      speed: { label: 'Very Fast', percent: 96, tone: 'success' }
    };
  }

  if (key.includes('forest') || key.includes('tree')) {
    return {
      title: 'Random Forest',
      description: 'An ensemble of decision trees that balances accuracy with interpretability. Robust to noisy inputs and missing data.',
      interpretability: { label: 'Medium', percent: 60, tone: 'info' },
      speed: { label: 'Fast', percent: 75, tone: 'success' }
    };
  }

  return {
    title: modelType || 'Custom Model',
    description: 'Custom registered model. Run a prediction to see how it performs on your inputs.',
    interpretability: { label: 'Unknown', percent: 50, tone: 'default' },
    speed: { label: 'Unknown', percent: 50, tone: 'default' }
  };
}

function toneToColor(tone, theme) {
  if (tone === 'warning') return theme.palette.warning.main;
  if (tone === 'success') return theme.palette.success.main;
  if (tone === 'info') return theme.palette.info.main;
  return alpha(theme.palette.common.white, 0.45);
}

function MetricBar({ label, percent, valueLabel, color }) {
  const theme = useTheme();
  const safePercent = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  return (
    <Stack spacing={0.85}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ color: alpha(theme.palette.common.white, 0.85), fontSize: '0.85rem', fontWeight: 500 }}>{label}</Typography>
        <Typography sx={{ color: alpha(theme.palette.common.white, 0.55), fontSize: '0.85rem', fontWeight: 500 }}>{valueLabel}</Typography>
      </Stack>
      <Box
        sx={{
          height: 4,
          borderRadius: 2,
          bgcolor: alpha(theme.palette.primary.main, 0.18),
          overflow: 'hidden'
        }}
      >
        <Box
          sx={{
            width: `${safePercent}%`,
            height: '100%',
            bgcolor: color,
            borderRadius: 2,
            transition: 'width 240ms ease'
          }}
        />
      </Box>
    </Stack>
  );
}

function InfoField({ label, children }) {
  const theme = useTheme();
  return (
    <Stack spacing={0.65}>
      <Typography
        sx={{
          color: alpha(theme.palette.primary.light, 0.7),
          fontSize: '0.68rem',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase'
        }}
      >
        {label}
      </Typography>
      <Box sx={{ color: alpha(theme.palette.common.white, 0.85), fontSize: '0.85rem', fontWeight: 500 }}>{children}</Box>
    </Stack>
  );
}

export default function ModelSelectionStep({ models, selectedModelId, onSelect, isLoading, loadError, actionError }) {
  const theme = useTheme();

  // Same color tokens used by the Overview metric cards and the styled table
  // Papers in Analytics / Field Records, so this step shares one surface theme.
  const cardSurface = `color-mix(in srgb, ${theme.palette.primary.main} 8%, ${theme.palette.background.paper})`;
  const cardDefaultBorder = alpha(theme.palette.primary.main, 0.22);
  const cardHoverBorder = alpha(theme.palette.primary.main, 0.5);
  const cardSelectedBorder = theme.palette.primary.main;
  const sectionDivider = alpha(theme.palette.primary.main, 0.18);
  const labelMuted = alpha(theme.palette.common.white, 0.65);
  const headingColor = theme.palette.common.white;

  return (
    <Stack spacing={2.75}>
      <Stack spacing={0.5}>
        <Typography variant="h4" sx={{ fontWeight: 700, color: headingColor, lineHeight: 1.2 }}>
          Select Prediction Model
        </Typography>
        <Typography sx={{ color: labelMuted, fontSize: '0.95rem', maxWidth: 760, lineHeight: 1.55 }}>
          Choose which registered model to use for this prediction run. Both models support all available crop types — you'll select your
          crop in the next step.
        </Typography>
      </Stack>

      {/* Hint banner */}
      <Paper
        variant="outlined"
        sx={{
          bgcolor: cardSurface,
          borderColor: cardDefaultBorder,
          borderRadius: 2,
          p: 2,
          backgroundImage: 'none'
        }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <Box
            sx={{
              color: alpha(theme.palette.primary.light, 0.95),
              fontSize: '1.1rem',
              mt: 0.35,
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <InfoCircleOutlined />
          </Box>
          <Typography sx={{ color: alpha(theme.palette.common.white, 0.78), fontSize: '0.9rem', lineHeight: 1.6 }}>
            <Box component="span" sx={{ fontWeight: 700, color: headingColor }}>
              Which model should I pick?
            </Box>{' '}
            <br />
            Use{' '}
            <Box component="span" sx={{ fontWeight: 700, color: headingColor }}>
              Deep Learning
            </Box>{' '}
            when your input data has many numeric features or non-linear interactions (e.g., spectral, weather, soil data). Use{' '}
            <Box component="span" sx={{ fontWeight: 700, color: headingColor }}>
              CatBoost
            </Box>{' '}
            when your inputs include field records or management notes. It's more interpretable and easier to audit.
          </Typography>
        </Stack>
      </Paper>

      {loadError ? <Alert severity="error">{loadError}</Alert> : null}
      {actionError ? <Alert severity="error">{actionError}</Alert> : null}

      {isLoading ? (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">
            Loading available models...
          </Typography>
        </Stack>
      ) : null}

      {!isLoading && models.length === 0 ? (
        <Alert severity="warning">No model versions found. Register a model version before running predictions.</Alert>
      ) : null}

      <Stack spacing={2}>
        {models.map((model) => {
          const metrics = model.performance_metrics || {};
          const r2 = typeof metrics.r2 === 'number' ? metrics.r2 : null;
          const isSelected = selectedModelId === model.model_version_id;
          const meta = getModelMeta(model.model_type);
          const interpretabilityColor = toneToColor(meta.interpretability.tone, theme);
          const speedColor = toneToColor(meta.speed.tone, theme);
          const accuracyPercent = r2 !== null ? Math.round(r2 * 100) : 0;
          const accuracyLabel = r2 !== null ? r2.toFixed(2) : '—';

          return (
            <Paper
              key={model.model_version_id}
              variant="outlined"
              onClick={() => onSelect(model.model_version_id)}
              sx={{
                cursor: 'pointer',
                p: { xs: 2.25, md: 3 },
                bgcolor: cardSurface,
                borderRadius: 2,
                borderColor: isSelected ? cardSelectedBorder : cardDefaultBorder,
                borderWidth: isSelected ? 2 : 1,
                backgroundImage: 'none',
                transition: 'border-color 180ms ease',
                '&:hover': {
                  borderColor: isSelected ? cardSelectedBorder : cardHoverBorder
                }
              }}
            >
              <Stack spacing={2.25}>
                <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
                  <Radio
                    checked={isSelected}
                    onChange={() => onSelect(model.model_version_id)}
                    onClick={(event) => event.stopPropagation()}
                    sx={{ p: 0.5, mt: -0.35 }}
                  />
                  <Stack spacing={0.85} sx={{ flex: 1 }}>
                    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                      <Typography sx={{ fontWeight: 700, color: headingColor, fontSize: '1.05rem', lineHeight: 1.25 }}>
                        {meta.title}
                      </Typography>
                      {isSelected ? (
                        <Chip
                          label="SELECTED"
                          size="small"
                          sx={{
                            bgcolor: alpha(theme.palette.primary.main, 0.28),
                            color: theme.palette.primary.light,
                            border: `1px solid ${alpha(theme.palette.primary.main, 0.55)}`,
                            fontWeight: 700,
                            letterSpacing: '0.1em',
                            fontSize: '0.62rem',
                            height: 20,
                            borderRadius: 999,
                            '& .MuiChip-label': { px: 1 }
                          }}
                        />
                      ) : null}
                    </Stack>
                    <Typography sx={{ color: alpha(theme.palette.common.white, 0.65), fontSize: '0.875rem', lineHeight: 1.6 }}>
                      {meta.description}
                    </Typography>
                  </Stack>
                </Stack>

                <Box sx={{ pl: { xs: 0, sm: 4.5 } }}>
                  <Grid container spacing={3}>
                    <Grid size={{ xs: 12, md: 4 }}>
                      <MetricBar
                        label="Accuracy (R²)"
                        percent={accuracyPercent}
                        valueLabel={accuracyLabel}
                        color={theme.palette.info.main}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, md: 4 }}>
                      <MetricBar
                        label="Interpretability"
                        percent={meta.interpretability.percent}
                        valueLabel={meta.interpretability.label}
                        color={interpretabilityColor}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, md: 4 }}>
                      <MetricBar label="Speed" percent={meta.speed.percent} valueLabel={meta.speed.label} color={speedColor} />
                    </Grid>
                  </Grid>
                </Box>

                <Divider sx={{ borderColor: sectionDivider }} />

                <Box sx={{ pl: { xs: 0, sm: 4.5 } }}>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 6, md: 3 }}>
                      <InfoField label="Algorithm">
                        {model.model_type ? (
                          <Chip
                            label={model.model_type}
                            size="small"
                            sx={{
                              bgcolor: alpha(theme.palette.primary.main, 0.12),
                              color: alpha(theme.palette.common.white, 0.9),
                              border: `1px solid ${alpha(theme.palette.primary.main, 0.35)}`,
                              fontWeight: 500,
                              fontSize: '0.72rem',
                              height: 22,
                              borderRadius: 1,
                              '& .MuiChip-label': { px: 1 }
                            }}
                          />
                        ) : (
                          '—'
                        )}
                      </InfoField>
                    </Grid>
                    <Grid size={{ xs: 6, md: 3 }}>
                      <InfoField label="Model Version">ID: {model.model_version_id ?? '—'}</InfoField>
                    </Grid>
                    <Grid size={{ xs: 6, md: 3 }}>
                      <InfoField label="Trained">{formatTrainingDate(model.training_date)}</InfoField>
                    </Grid>
                    <Grid size={{ xs: 6, md: 3 }}>
                      <InfoField label="Crop Support">All crops available</InfoField>
                    </Grid>
                  </Grid>
                </Box>
              </Stack>
            </Paper>
          );
        })}
      </Stack>
    </Stack>
  );
}
