// Primary scope selector for the Analytics chart cards. Promoted out of
// the secondary filter bar into its own prominent row so users see
// "which subset of predictions am I looking at?" before they read any
// metric. This is the single biggest control on each card — flipping
// it shifts the headline R² and the row count meaningfully, so the
// visual weight matches the impact.
//
// Used identically in ModelRegressionCard and ResidualDiagnosticsCard.
// Shared component (rather than per-card inline) so the two cards stay
// in lockstep — a styling tweak here updates both surfaces at once.
//
// Renders nothing when the active model has no coverage.json (the
// backend reports coverage.available = false) — older / legacy models
// don't have a meaningful scope to filter on, so we silently hide the
// control rather than show a disabled selector.

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';

import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';

// Tab metadata — order intentional: training set (narrowest, 1,002) →
// similar (middle, ~3,067) → all (3,435). Reads as a left-to-right
// "zoom out" from strict to inclusive, matching how a user mentally
// expands or contracts their question.
const TABS = [
  {
    value: 'in_envelope',
    label: 'Training set',
    countKey: 'in_envelope_total',
    summary: 'In-sample R² on the rows the model was trained on.'
  },
  {
    value: 'in_distribution',
    label: 'Similar to training',
    countKey: 'in_distribution_total',
    summary: 'Training + production rows whose inputs look like training data.'
  },
  {
    value: 'all',
    label: 'All predictions',
    countKey: 'total_predictions',
    summary: 'Every prediction, including out-of-distribution rows.'
  }
];

// Long-form description rendered inside the info tooltip. Built as JSX
// so each tier can have its own bold heading and prose — the muxed
// "wall of text" tooltip we had before was hard to parse at a glance.
function ScopeDescriptionPanel({ theme, totals }) {
  const formatCount = (key) =>
    typeof totals?.[key] === 'number' ? `${totals[key].toLocaleString()} field-seasons` : null;
  return (
    <Stack spacing={1.25} sx={{ maxWidth: 460 }}>
      <Typography sx={{ color: theme.palette.common.white, fontWeight: 700, fontSize: '0.82rem' }}>
        What you’re looking at
      </Typography>
      <Stack spacing={0.4}>
        <Typography sx={{ color: theme.palette.primary.light, fontSize: '0.74rem', fontWeight: 700 }}>
          Training set only{formatCount('in_envelope_total') ? ` · ${formatCount('in_envelope_total')}` : ''}
        </Typography>
        <Typography sx={{ color: alpha(theme.palette.common.white, 0.82), fontSize: '0.74rem', lineHeight: 1.55 }}>
          The exact field-seasons the model was trained on. R² here is{' '}
          <Box component="span" sx={{ fontWeight: 700, color: theme.palette.common.white }}>
            in-sample
          </Box>{' '}
          — the model has effectively memorized these rows, so the score will be higher than the
          published cross-validation R². Useful to verify the model fits the data it was trained on.
        </Typography>
      </Stack>
      <Stack spacing={0.4}>
        <Typography sx={{ color: theme.palette.primary.light, fontSize: '0.74rem', fontWeight: 700 }}>
          Similar to training (default){formatCount('in_distribution_total') ? ` · ${formatCount('in_distribution_total')}` : ''}
        </Typography>
        <Typography sx={{ color: alpha(theme.palette.common.white, 0.82), fontSize: '0.74rem', lineHeight: 1.55 }}>
          The training set{' '}
          <Box component="span" sx={{ fontWeight: 700, color: theme.palette.common.white }}>
            plus
          </Box>{' '}
          production rows whose inputs (state, county, variety, yield, acres, totalN) fall inside
          the training distribution. This is the most meaningful real-world R² — the slice where
          the model’s predictions are trustworthy.
        </Typography>
      </Stack>
      <Stack spacing={0.4}>
        <Typography sx={{ color: theme.palette.primary.light, fontSize: '0.74rem', fontWeight: 700 }}>
          All predictions{formatCount('total_predictions') ? ` · ${formatCount('total_predictions')}` : ''}
        </Typography>
        <Typography sx={{ color: alpha(theme.palette.common.white, 0.82), fontSize: '0.74rem', lineHeight: 1.55 }}>
          Every backfilled prediction, including rows whose inputs the model has no training basis
          for. R² dilutes against these poorly-handled cases — useful to see the gap between
          trained-envelope performance and full-population performance.
        </Typography>
      </Stack>
    </Stack>
  );
}

export default function CoverageScopeSelector({ value, onChange, coverage }) {
  const theme = useTheme();
  if (!coverage?.available) return null;

  const activeTab = TABS.find((t) => t.value === value) || TABS[1]; // default to "in_distribution"
  const totals = coverage || {};

  return (
    // No wrapping panel — the buttons themselves carry the visual weight
    // (rectangular soft-cornered surfaces with raised/pressed shadow
    // states), so a containing card with background + border was
    // double-emphasizing the control and reading as a busy panel rather
    // than three obvious-to-click buttons. The selector now sits flat
    // in the header flow alongside the title and metrics.
    <Stack spacing={0.5}>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1.25 }}>
          <Typography
            sx={{
              color: alpha(theme.palette.primary.light, 0.95),
              fontSize: '0.7rem',
              fontWeight: 800,
              letterSpacing: '0.16em',
              textTransform: 'uppercase'
            }}
          >
            Showing
          </Typography>
          <ToggleButtonGroup
            value={value}
            exclusive
            size="small"
            onChange={(_, next) => {
              if (next) onChange(next);
            }}
            sx={{
              // Each option styled as its own clickable button rather
              // than a connected segmented control. Soft-cornered
              // rectangles (8px radius) read as button-shaped without
              // looking heavy. Visible gaps between buttons make it
              // obvious there are three independent affordances.
              //
              // The unselected state has a subtle drop shadow + brighter
              // border to look "raised, clickable"; the selected state
              // flips to an inset shadow + heavier fill to look "pressed
              // in", giving the user clear tactile feedback about
              // which option is active.
              gap: 1,
              '& .MuiToggleButtonGroup-grouped': {
                // MUI defaults the grouped buttons to a shared rounded
                // pill with overlapping borders. We override:
                //   - borderRadius → 8px on every button (rectangular soft)
                //   - marginLeft → 0 so they don't overlap
                //   - per-side border restored on every button
                borderRadius: '8px !important',
                marginLeft: '0 !important',
                border: `1px solid ${alpha(theme.palette.primary.main, 0.55)} !important`,
                '&:not(:first-of-type)': {
                  borderLeft: `1px solid ${alpha(theme.palette.primary.main, 0.55)} !important`
                }
              },
              '& .MuiToggleButton-root': {
                textTransform: 'none',
                fontWeight: 700,
                fontSize: '0.82rem',
                letterSpacing: '0.01em',
                color: alpha(theme.palette.common.white, 0.88),
                bgcolor: alpha(theme.palette.primary.main, 0.18),
                px: 1.85,
                py: 0.75,
                minHeight: 36,
                gap: 0.5,
                lineHeight: 1.25,
                whiteSpace: 'nowrap',
                // Raised look on idle/hover — subtle drop shadow + a
                // 1px white-tinted inset top edge for a softly lit feel.
                boxShadow: `0 1px 2px ${alpha(theme.palette.common.black, 0.35)}, inset 0 1px 0 ${alpha(theme.palette.common.white, 0.05)}`,
                transition:
                  'background 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease',
                '&:hover': {
                  bgcolor: alpha(theme.palette.primary.main, 0.3),
                  color: theme.palette.common.white,
                  borderColor: `${alpha(theme.palette.primary.main, 0.85)} !important`,
                  // Bigger lift on hover to reinforce "I am clickable".
                  boxShadow: `0 2px 5px ${alpha(theme.palette.common.black, 0.4)}, inset 0 1px 0 ${alpha(theme.palette.common.white, 0.08)}`
                },
                '&:active': {
                  // Tactile press feedback — button drops 1px and loses
                  // its raised shadow so the click feels physical.
                  transform: 'translateY(1px)',
                  boxShadow: `0 0 0 transparent, inset 0 1px 3px ${alpha(theme.palette.common.black, 0.3)}`
                },
                '&.Mui-selected': {
                  // "Pressed in" look — inset shadow + a thin primary-
                  // light ring inside the border makes it visually
                  // recessed, clearly distinct from the raised idle
                  // siblings. No drop shadow when selected.
                  bgcolor: alpha(theme.palette.primary.main, 0.55),
                  color: theme.palette.common.white,
                  borderColor: `${theme.palette.primary.main} !important`,
                  boxShadow: `inset 0 2px 4px ${alpha(theme.palette.common.black, 0.35)}, inset 0 0 0 1px ${alpha(theme.palette.primary.light, 0.45)}`,
                  '&:hover': {
                    bgcolor: alpha(theme.palette.primary.main, 0.6),
                    boxShadow: `inset 0 2px 4px ${alpha(theme.palette.common.black, 0.35)}, inset 0 0 0 1px ${alpha(theme.palette.primary.light, 0.55)}`
                  }
                }
              }
            }}
          >
            {TABS.map((tab) => {
              const n = totals[tab.countKey];
              const showCount = typeof n === 'number';
              return (
                <ToggleButton key={tab.value} value={tab.value} aria-label={tab.label}>
                  {tab.label}
                  {showCount ? (
                    <Box
                      component="span"
                      sx={{
                        ml: 0.65,
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        opacity: 0.75,
                        fontVariantNumeric: 'tabular-nums'
                      }}
                    >
                      · {n.toLocaleString()}
                    </Box>
                  ) : null}
                </ToggleButton>
              );
            })}
          </ToggleButtonGroup>
        </Stack>
        {/* Info icon — opens the long-form description on hover/focus.
            Sits at the right edge of the row so it doesn't compete with
            the toggle group for eye attention but is reachable for
            anyone who wants the full explanation. */}
        <Tooltip
          arrow
          placement="left"
          title={<ScopeDescriptionPanel theme={theme} totals={totals} />}
          slotProps={{
            tooltip: {
              sx: {
                bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 22%, ${theme.palette.background.paper})`,
                border: `1px solid ${alpha(theme.palette.primary.main, 0.55)}`,
                maxWidth: 480,
                px: 1.75,
                py: 1.5,
                borderRadius: 1.5,
                boxShadow: `0 10px 32px ${alpha(theme.palette.common.black, 0.45)}`
              }
            },
            arrow: {
              sx: { color: `color-mix(in srgb, ${theme.palette.primary.main} 22%, ${theme.palette.background.paper})` }
            }
          }}
        >
          <Box
            component="span"
            tabIndex={0}
            role="img"
            aria-label="About the scope selector — hover for details"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              cursor: 'help',
              color: alpha(theme.palette.primary.light, 0.85),
              fontSize: '1rem',
              transition: 'color 0.15s ease',
              outline: 'none',
              '&:hover, &:focus-visible': { color: theme.palette.primary.light }
            }}
          >
            <InfoCircleOutlined />
          </Box>
        </Tooltip>
      </Stack>
      {/* One-line summary of the currently-active scope. Sits under the
          toggle so the user always sees a plain-English description
          of what they're looking at, without having to open the info
          tooltip. */}
      <Typography
        sx={{
          color: alpha(theme.palette.common.white, 0.65),
          fontSize: '0.76rem',
          fontWeight: 500,
          lineHeight: 1.5
        }}
      >
        {activeTab.summary}
      </Typography>
    </Stack>
  );
}
