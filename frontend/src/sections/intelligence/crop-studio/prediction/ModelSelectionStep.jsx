import { useState } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';
import CloseOutlined from '@ant-design/icons/CloseOutlined';
import DownOutlined from '@ant-design/icons/DownOutlined';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';

// Maps a raw model_type string from the API to a human-readable title,
// long-form description, and the relative interpretability indicator
// shown on the model card. Speed used to live here too but was dropped
// — the metric bars now surface real API-sourced data (validation RMSE
// and training-date freshness) instead of two hardcoded heuristics.
// Interpretability stays as a hand-curated label because it's
// genuinely useful for users picking between models and the API
// doesn't expose anything equivalent.
function getModelMeta(modelType) {
  const key = String(modelType || '').toLowerCase();

  if (key.includes('deep') || key.includes('pytorch') || key.includes('neural')) {
    return {
      title: 'Deep Learning',
      description:
        'A flexible neural network that captures complex, non-linear relationships across many numeric inputs. Performs best when combining spectral, weather, and soil features. Less transparent but highly adaptive to varied field conditions.',
      interpretability: { label: 'Low', percent: 25, tone: 'warning' }
    };
  }

  if (key.includes('catboost') || key.includes('lgbm') || key.includes('lightgbm') || key.includes('boost')) {
    return {
      title: 'CatBoost',
      description:
        'A gradient boosting model well-suited for categorical and mixed-type inputs like field records and management data. More interpretable and stable — a strong choice for understanding which factors are driving your predictions.',
      interpretability: { label: 'High', percent: 88, tone: 'success' }
    };
  }

  if (key.includes('forest') || key.includes('tree')) {
    return {
      title: 'Random Forest',
      description: 'An ensemble of decision trees that balances accuracy with interpretability. Robust to noisy inputs and missing data.',
      interpretability: { label: 'Medium', percent: 60, tone: 'info' }
    };
  }

  return {
    title: modelType || 'Custom Model',
    description: 'Custom registered model. Run a prediction to see how it performs on your inputs.',
    interpretability: { label: 'Unknown', percent: 50, tone: 'default' }
  };
}

function toneToColor(tone, theme) {
  if (tone === 'warning') return theme.palette.warning.main;
  if (tone === 'success') return theme.palette.success.main;
  if (tone === 'info') return theme.palette.info.main;
  return alpha(theme.palette.common.white, 0.45);
}

// Validation-RMSE display for the first metric bar. Reads the real
// `performance_metrics.val_rmse` from the API; returns an `available:
// false` payload when the model's metrics object doesn't carry an
// RMSE (e.g. the Deep Learning model exposes `final_loss` instead).
// The bar fill is mapped against a fixed 30-bu/ac reference span:
// 0 bu/ac RMSE = 100% bar (perfect), 30+ bu/ac RMSE = 0% bar (poor).
// That reference is calibrated to the observed yield distribution
// (~15–187 bu/ac), so an RMSE of 10 lands at ~67% — visually "good
// but not perfect," which matches how a domain expert would read it.
// Tones step in three bands: <10 → success, <20 → info, ≥20 → warning.
function getValRmseDisplay(model) {
  const rmseRaw = model?.performance_metrics?.val_rmse;
  const rmse = typeof rmseRaw === 'number' && Number.isFinite(rmseRaw) ? rmseRaw : null;
  if (rmse === null) {
    return { available: false, label: '—', percent: 0, tone: 'default' };
  }
  const RMSE_REFERENCE_SPAN = 30;
  const percent = Math.max(0, Math.min(100, (1 - rmse / RMSE_REFERENCE_SPAN) * 100));
  const tone = rmse < 10 ? 'success' : rmse < 20 ? 'info' : 'warning';
  return {
    available: true,
    label: `${rmse.toFixed(1)} bu/ac`,
    percent,
    tone
  };
}

// Training-date freshness for the third metric bar. Reads the real
// `training_date` from the API and computes "how recent" relative to
// a 1-year horizon: same-day = 100% bar, 1 year old = 0% bar. Tone
// steps reward fresh models (≤90 days → success, ≤180 → info, older
// → warning), nudging users toward retraining when the bar is dim.
// Date label is locale-formatted (e.g., "Apr 6, 2026") so it reads
// the same across all the dates on this page.
function getFreshnessDisplay(model) {
  const dateRaw = model?.training_date;
  if (!dateRaw) {
    return { available: false, label: '—', percent: 0, tone: 'default' };
  }
  const trained = new Date(dateRaw);
  if (Number.isNaN(trained.getTime())) {
    return { available: false, label: '—', percent: 0, tone: 'default' };
  }
  const FRESHNESS_HORIZON_DAYS = 365;
  const daysAgo = Math.max(0, (Date.now() - trained.getTime()) / 86_400_000);
  const percent = Math.max(0, Math.min(100, (1 - daysAgo / FRESHNESS_HORIZON_DAYS) * 100));
  const tone = daysAgo <= 90 ? 'success' : daysAgo <= 180 ? 'info' : 'warning';
  return {
    available: true,
    label: trained.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    percent,
    tone
  };
}

function MetricBar({ label, percent, valueLabel, color, info }) {
  const theme = useTheme();
  const safePercent = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  return (
    <Stack spacing={0.85}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.6 }}>
          <Typography sx={{ color: alpha(theme.palette.common.white, 0.85), fontSize: '0.85rem', fontWeight: 500 }}>{label}</Typography>
          {info ? (
            <Tooltip
              arrow
              placement="top"
              title={info}
              slotProps={{
                tooltip: {
                  sx: {
                    bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})`,
                    color: theme.palette.common.white,
                    border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
                    boxShadow: `0 6px 16px ${alpha(theme.palette.common.black, 0.45)}`,
                    p: 1.1,
                    maxWidth: 280,
                    borderRadius: 1,
                    fontSize: '0.75rem',
                    lineHeight: 1.45
                  }
                },
                arrow: { sx: { color: `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})` } }
              }}
            >
              <Box
                component="span"
                tabIndex={0}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  cursor: 'help',
                  color: alpha(theme.palette.common.white, 0.55),
                  fontSize: '0.78rem',
                  lineHeight: 1,
                  transition: 'color 120ms ease',
                  '&:hover, &:focus-visible': { color: theme.palette.primary.light, outline: 'none' }
                }}
              >
                <InfoCircleOutlined />
              </Box>
            </Tooltip>
          ) : null}
        </Stack>
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

function MetricValue({ label, valueLabel, color }) {
  const theme = useTheme();
  return (
    <Stack spacing={0.85}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ color: alpha(theme.palette.common.white, 0.85), fontSize: '0.85rem', fontWeight: 500 }}>{label}</Typography>
        <Typography sx={{ color: color || alpha(theme.palette.common.white, 0.85), fontSize: '0.85rem', fontWeight: 600 }}>{valueLabel}</Typography>
      </Stack>
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
  // Hint banner is collapsible — closed by default so the wizard's
  // primary content (the model cards) leads the page on first paint.
  // Users who want the "Why use CatBoost?" guidance can pop it open
  // with a single click on the header.
  const [hintOpen, setHintOpen] = useState(false);

  // Surface tokens matched to the Overview tab's metric-tile family —
  // bright primary-tinted bg with a half-alpha primary border + soft
  // drop shadow. Previously used a darker `color-mix(8% primary, paper)`
  // surface that read as muted navy and felt visually disconnected
  // from the rest of the page. Aligning to the Overview tile values
  // makes every primary-blue surface in the app one cohesive family.
  const cardSurface = alpha(theme.palette.primary.main, 0.18);
  const cardDefaultBorder = alpha(theme.palette.primary.main, 0.5);
  const cardHoverBorder = alpha(theme.palette.primary.main, 0.75);
  const cardSelectedBorder = theme.palette.primary.main;
  const cardShadow = `0 4px 14px ${alpha(theme.palette.common.black, 0.35)}`;
  const sectionDivider = alpha(theme.palette.primary.main, 0.28);
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

      {/* Hint banner — collapsible. The clickable header row controls
          the toggle (cursor:pointer + hover bg highlight); a discrete
          IconButton on the right doubles as a visual chevron/close
          affordance for users who don't realize the whole strip is
          clickable. Same pattern as the OverviewTableBanner so the
          two read as one component family. */}
      <Paper
        variant="outlined"
        sx={{
          bgcolor: cardSurface,
          borderColor: cardDefaultBorder,
          borderRadius: 2,
          backgroundImage: 'none',
          overflow: 'hidden',
          boxShadow: cardShadow
        }}
      >
        <Stack
          direction="row"
          spacing={1.5}
          sx={{
            alignItems: 'center',
            px: 2,
            py: 1.5,
            cursor: 'pointer',
            '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.08) }
          }}
          onClick={() => setHintOpen((prev) => !prev)}
          role="button"
          aria-expanded={hintOpen}
          aria-label="Toggle why-use-catboost hint"
        >
          <Box
            sx={{
              color: alpha(theme.palette.primary.light, 0.95),
              fontSize: '1.05rem',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <InfoCircleOutlined />
          </Box>
          <Typography
            sx={{
              flex: 1,
              fontWeight: 700,
              color: headingColor,
              fontSize: '0.92rem',
              letterSpacing: '0.01em'
            }}
          >
            Why use CatBoost?
          </Typography>
          <IconButton
            size="small"
            aria-label={hintOpen ? 'Close hint' : 'Open hint'}
            onClick={(event) => {
              event.stopPropagation();
              setHintOpen((prev) => !prev);
            }}
            sx={{
              color: alpha(theme.palette.common.white, 0.7),
              '&:hover': {
                color: theme.palette.common.white,
                bgcolor: alpha(theme.palette.primary.main, 0.18)
              }
            }}
          >
            {hintOpen ? <CloseOutlined style={{ fontSize: '0.85rem' }} /> : <DownOutlined style={{ fontSize: '0.85rem' }} />}
          </IconButton>
        </Stack>
        <Collapse in={hintOpen} unmountOnExit>
          <Box sx={{ px: 2, pb: 2, pl: 5 }}>
            <Typography sx={{ color: alpha(theme.palette.common.white, 0.85), fontSize: '0.9rem', lineHeight: 1.6 }}>
              Use{' '}
              <Box component="span" sx={{ fontWeight: 700, color: headingColor }}>
                CatBoost
              </Box>{' '}
              when your inputs include field records or management notes. It's more interpretable and easier to audit.
            </Typography>
          </Box>
        </Collapse>
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
          const isSelected = selectedModelId === model.model_version_id;
          const meta = getModelMeta(model.model_type);
          const interpretabilityColor = toneToColor(meta.interpretability.tone, theme);
          // Real API-sourced metrics replacing the previous broken R²
          // and hardcoded Speed. RMSE comes from
          // `performance_metrics.val_rmse`; freshness comes from
          // `training_date`. Both helpers gracefully degrade to an
          // `available: false` payload when the model doesn't expose
          // the source field (the DL model returns `final_loss`
          // instead of RMSE), in which case the corresponding metric
          // bar renders an empty 0% fill with a "—" label.
          const rmse = getValRmseDisplay(model);
          const freshness = getFreshnessDisplay(model);
          const rmseColor = toneToColor(rmse.tone, theme);
          const freshnessColor = toneToColor(freshness.tone, theme);

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
                boxShadow: cardShadow,
                transition: 'border-color 180ms ease, box-shadow 180ms ease',
                '&:hover': {
                  borderColor: isSelected ? cardSelectedBorder : cardHoverBorder,
                  boxShadow: `0 6px 20px ${alpha(theme.palette.common.black, 0.4)}`
                }
              }}
            >
              <Stack spacing={2.25}>
                <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
                  <Radio
                    checked={isSelected}
                    onChange={() => onSelect(model.model_version_id)}
                    onClick={(event) => event.stopPropagation()}
                    // Theme the radio so it sits in the primary-blue
                    // family rather than rendering as MUI's default
                    // neutral gray. Idle state is faded primary.light;
                    // checked state is solid primary.main, matching the
                    // selected card's border color.
                    sx={{
                      p: 0.5,
                      mt: -0.35,
                      color: alpha(theme.palette.primary.light, 0.55),
                      '&.Mui-checked': { color: theme.palette.primary.main },
                      '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.12) }
                    }}
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
                        label="Validation RMSE"
                        percent={rmse.percent}
                        valueLabel={rmse.label}
                        color={rmseColor}
                        info="Root-mean-square error on the model's validation set, in bushels/acre. It's the average distance between the model's predicted yield and the actual yield on data it didn't see during training — so lower is better. The bar fills more as RMSE approaches 0 (perfect), and empties as it approaches 30 bu/ac (poor)."
                      />
                      {/* Disclaimer when the model doesn't expose an
                          RMSE (e.g., the Deep Learning model returns
                          `final_loss` instead). Without this, the bar
                          would render as a flat 0% which a casual
                          reader could mistake for "this model is bad."
                          The italic muted note makes it clear the
                          metric is simply absent for this model. */}
                      {!rmse.available ? (
                        <Typography
                          sx={{
                            mt: 0.5,
                            color: alpha(theme.palette.common.white, 0.5),
                            fontSize: '0.72rem',
                            fontStyle: 'italic',
                            lineHeight: 1.4
                          }}
                        >
                          Not reported for this model
                        </Typography>
                      ) : null}
                    </Grid>
                    <Grid size={{ xs: 12, md: 4 }}>
                      <MetricBar
                        label="Interpretability"
                        percent={meta.interpretability.percent}
                        valueLabel={meta.interpretability.label}
                        color={interpretabilityColor}
                        info="How easily a prediction can be traced back to the inputs that drove it. High means the model exposes per-feature importances and per-prediction reasoning (good for understanding why a yield came out the way it did). Low means the model is more of a black box — accurate, but harder to explain."
                      />
                    </Grid>
                    <Grid size={{ xs: 12, md: 4 }}>
                      <MetricValue
                        label="Last Trained"
                        valueLabel={freshness.label}
                        color={freshnessColor}
                      />
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
                      {/* "Trained" date moved up into the Last Trained
                          metric bar — surfacing it again here would
                          duplicate the same value. Replaced with
                          production status (the real `is_production`
                          flag), which is the next-most-actionable
                          metadata when the user is picking a model. */}
                      <InfoField label="Status">
                        {model.is_production ? (
                          <Chip
                            label="PRODUCTION"
                            size="small"
                            sx={{
                              bgcolor: alpha(theme.palette.success.main, 0.18),
                              color: theme.palette.success.light,
                              border: `1px solid ${alpha(theme.palette.success.main, 0.5)}`,
                              fontWeight: 700,
                              letterSpacing: '0.08em',
                              fontSize: '0.62rem',
                              height: 22,
                              borderRadius: 999,
                              '& .MuiChip-label': { px: 1 }
                            }}
                          />
                        ) : (
                          <Chip
                            label="Available"
                            size="small"
                            sx={{
                              bgcolor: alpha(theme.palette.primary.main, 0.12),
                              color: alpha(theme.palette.common.white, 0.75),
                              border: `1px solid ${alpha(theme.palette.primary.main, 0.35)}`,
                              fontWeight: 500,
                              fontSize: '0.7rem',
                              height: 22,
                              borderRadius: 999,
                              '& .MuiChip-label': { px: 1 }
                            }}
                          />
                        )}
                      </InfoField>
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
