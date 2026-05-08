import Chip from '@mui/material/Chip';
import { alpha, useTheme } from '@mui/material/styles';

// Returns themed colors for the delta chip based on the absolute percentage
// difference between predicted and observed yield. Buckets:
//   ≤ 5%   — success green ("model nailed it")
//   ≤ 15%  — warning amber ("close but off")
//    > 15% — error red    ("model and reality diverged")
function getDeltaTone(absPct, theme) {
  if (absPct <= 5) {
    return {
      fg: theme.palette.success.light,
      bg: alpha(theme.palette.success.main, 0.16),
      border: alpha(theme.palette.success.main, 0.45)
    };
  }
  if (absPct <= 15) {
    return {
      fg: theme.palette.warning.light,
      bg: alpha(theme.palette.warning.main, 0.16),
      border: alpha(theme.palette.warning.main, 0.45)
    };
  }
  return {
    fg: theme.palette.error.light,
    bg: alpha(theme.palette.error.main, 0.18),
    border: alpha(theme.palette.error.main, 0.45)
  };
}

/**
 * Small inline chip showing how far off a predicted yield is from the
 * observed yield, as a signed percentage (e.g. "+8%", "-12%"). Color tone
 * communicates accuracy bucket. Returns null when either value is missing
 * or observed is zero (so the chip simply doesn't render and the cell
 * stays clean for current-season fields with no harvest yet).
 */
export default function YieldDeltaChip({ predicted, observed }) {
  const theme = useTheme();

  const predNum = Number(predicted);
  const obsNum = Number(observed);

  if (!Number.isFinite(predNum) || !Number.isFinite(obsNum) || obsNum === 0) {
    return null;
  }

  const pct = ((predNum - obsNum) / obsNum) * 100;
  const sign = pct >= 0 ? '+' : '';
  const tone = getDeltaTone(Math.abs(pct), theme);

  return (
    <Chip
      size="small"
      label={`${sign}${pct.toFixed(0)}%`}
      sx={{
        height: 20,
        fontSize: '0.68rem',
        fontWeight: 700,
        letterSpacing: '0.02em',
        color: tone.fg,
        bgcolor: tone.bg,
        border: `1px solid ${tone.border}`,
        borderRadius: 999,
        '& .MuiChip-label': { px: 0.85 }
      }}
    />
  );
}
