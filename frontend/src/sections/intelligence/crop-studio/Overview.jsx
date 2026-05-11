import { useEffect, useMemo, useState } from 'react';

import CloseOutlined from '@ant-design/icons/CloseOutlined';
import DownOutlined from '@ant-design/icons/DownOutlined';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';
import RightOutlined from '@ant-design/icons/RightOutlined';
import Collapse from '@mui/material/Collapse';

import { alpha, useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import MainCard from 'components/MainCard';
import FieldMapPreview from 'sections/intelligence/crop-studio/FieldMapPreview';
import FieldTable from 'sections/intelligence/crop-studio/FieldTable';
import { US_STATES } from 'sections/intelligence/crop-studio/usStatesPaths';
import { formatCropName } from 'utils/cropName';
import {
  getDaysToHarvest,
  getSeasonProgress,
  getWheatStage,
  STATE_HARVEST_DATES,
  STATE_PLANT_DATES
} from 'sections/intelligence/crop-studio/wheatSeasonHelpers';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

// TODO: pull from an auth/user context once that lands. Hardcoded for the
// dev session so the greeting reads as personal. Swap to `user?.firstName`
// (or whatever the eventual user shape provides) when wiring auth in.
const USER_NAME = 'Wheat Producers';

// Time-of-day greeting. Returns a string like "Good morning" / "Good afternoon"
// / "Good evening", or "Working late" past 10pm so the late-night case feels
// acknowledged rather than wrong.
function getTimeOfDayGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 22) return 'Good evening';
  return 'Working late';
}

// Smooth-scroll link to the simplified FieldTable. Used inside the
// min/max yield tooltips so a user reading "acres available in the
// field detail view" can jump straight to the table without losing
// their place on the page. Rendered as an anchor so middle-click /
// cmd-click still works as a fallback navigation, but the default
// click triggers `scrollIntoView({ behavior: 'smooth' })` for the
// in-page animation. Lives in this file so it can target the
// `id="overview-field-records"` anchor we set on the table below.
function FieldDetailViewLink({ children = 'field detail view' }) {
  const theme = useTheme();
  return (
    <Box
      component="a"
      href="#overview-field-records"
      onClick={(event) => {
        const target = document.getElementById('overview-field-records');
        if (!target) return;
        event.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }}
      sx={{
        color: theme.palette.primary.light,
        fontWeight: 700,
        textDecoration: 'underline',
        textDecorationThickness: '1px',
        textUnderlineOffset: '2px',
        cursor: 'pointer',
        transition: 'color 0.15s ease',
        '&:hover, &:focus-visible': { color: theme.palette.common.white, outline: 'none' }
      }}
    >
      {children}
    </Box>
  );
}

// Banner card that sits above the simplified FieldTable on the Overview
// tab. Mirrors the visual pattern of the original "Why predict yields"
// banner (Paper + clickable header row + collapsible body) so the user
// experience stays consistent, but the copy describes what the table
// below actually shows: each row is a field-season, click a row for a
// richer detail view. Default-open so first-time viewers don't have to
// hunt for the explanation.
function OverviewTableBanner() {
  const theme = useTheme();
  const [open, setOpen] = useState(true);
  return (
    <Paper
      variant="outlined"
      sx={{
        bgcolor: alpha(theme.palette.primary.main, 0.18),
        borderColor: alpha(theme.palette.primary.main, 0.5),
        borderRadius: 2,
        backgroundImage: 'none',
        overflow: 'hidden',
        boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.35)}`
      }}
    >
      <Stack
        direction="row"
        spacing={1.5}
        sx={{
          alignItems: 'center',
          px: 2.25,
          py: 1.5,
          cursor: 'pointer',
          '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.08) }
        }}
        onClick={() => setOpen((prev) => !prev)}
        role="button"
        aria-expanded={open}
        aria-label="Toggle field records explanation"
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
            color: theme.palette.common.white,
            fontSize: '0.92rem',
            letterSpacing: '0.01em'
          }}
        >
          About your field records
        </Typography>
        <IconButton
          size="small"
          aria-label={open ? 'Close explanation' : 'Open explanation'}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((prev) => !prev);
          }}
          sx={{
            color: alpha(theme.palette.common.white, 0.7),
            '&:hover': {
              color: theme.palette.common.white,
              bgcolor: alpha(theme.palette.primary.main, 0.18)
            }
          }}
        >
          {open ? <CloseOutlined style={{ fontSize: '0.85rem' }} /> : <DownOutlined style={{ fontSize: '0.85rem' }} />}
        </IconButton>
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 2.25, pb: 2, pl: 5.25 }}>
          <Typography sx={{ color: alpha(theme.palette.common.white, 0.85), fontSize: '0.88rem', lineHeight: 1.6 }}>
            Each row below is a{' '}
            <Box component="span" sx={{ fontWeight: 700, color: theme.palette.common.white }}>
              field-season
            </Box>{' '}
            — a single field tracked through one growing season. The
            table summarizes the observed (real-harvest) yield alongside
            its key inputs: crop and variety, acres, geographic
            location, and applied nutrients. Use the filters above the
            table to narrow by crop, variety, season, state, or county.
          </Typography>
          <Typography sx={{ color: alpha(theme.palette.common.white, 0.85), fontSize: '0.88rem', lineHeight: 1.6, mt: 1.25 }}>
            Click the{' '}
            <Box component="span" sx={{ fontWeight: 700, color: theme.palette.primary.light }}>
              chevron (›)
            </Box>{' '}
            on any row to open an in-depth view of that field-season,
            including the full management history, applied operations,
            and any model predictions attached to the record.
          </Typography>
        </Box>
      </Collapse>
    </Paper>
  );
}

// Top contributor breakdown for the Total Acres hero card. Renders a
// segmented horizontal bar where each segment is a state's share of the
// total, sorted descending. The first 3 states get distinct primary
// shades; everything else aggregates into an "Other" segment so the bar
// stays readable. Below the bar, we surface just the #1 contributor's
// name + percentage as the most actionable takeaway ("your dataset is
// concentrated in Kansas").
function AcresStateBreakdown({ stateStats, totalAcres }) {
  const theme = useTheme();
  const ranked = useMemo(() => {
    if (!stateStats) return [];
    return Object.values(stateStats)
      .filter((s) => s && Number.isFinite(s.total_acres) && s.total_acres > 0)
      .sort((a, b) => (b.total_acres || 0) - (a.total_acres || 0));
  }, [stateStats]);
  if (ranked.length === 0 || !Number.isFinite(totalAcres) || totalAcres <= 0) {
    return null;
  }
  // Three primary-tone shades for the top three states + a muted tone
  // for the Other rollup. Order is darkest → lightest so #1 reads as
  // "anchor" while smaller contributors fade into the background.
  const segmentColors = [
    theme.palette.primary.main,
    theme.palette.primary.light,
    alpha(theme.palette.primary.light, 0.55),
    alpha(theme.palette.common.white, 0.18)
  ];
  const top = ranked.slice(0, 3);
  const otherAcres = ranked.slice(3).reduce((sum, s) => sum + (s.total_acres || 0), 0);
  const segments = [
    ...top.map((s, i) => ({
      label: s.state,
      acres: s.total_acres,
      pct: (s.total_acres / totalAcres) * 100,
      color: segmentColors[i]
    })),
    ...(otherAcres > 0
      ? [{ label: 'Other', acres: otherAcres, pct: (otherAcres / totalAcres) * 100, color: segmentColors[3] }]
      : [])
  ];
  const leader = ranked[0];
  return (
    <Stack spacing={1}>
      <Box
        sx={{
          display: 'flex',
          width: '100%',
          height: 8,
          borderRadius: 999,
          overflow: 'hidden',
          bgcolor: alpha(theme.palette.common.black, 0.25)
        }}
      >
        {segments.map((seg) => (
          <Box
            key={seg.label}
            sx={{
              flexGrow: seg.pct,
              flexBasis: 0,
              bgcolor: seg.color,
              transition: 'flex-grow 0.4s ease'
            }}
          />
        ))}
      </Box>
      <Stack direction="row" spacing={1.25} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
        {segments.map((seg, i) => (
          <Stack key={seg.label} direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
            <Box
              component="span"
              sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: seg.color, flexShrink: 0 }}
            />
            <Typography
              sx={{
                color: i === 0 ? theme.palette.common.white : alpha(theme.palette.common.white, 0.7),
                fontSize: '0.72rem',
                fontWeight: i === 0 ? 700 : 500,
                fontVariantNumeric: 'tabular-nums'
              }}
            >
              {seg.label} · {seg.pct.toFixed(0)}%
            </Typography>
          </Stack>
        ))}
      </Stack>
      <Typography sx={{ color: alpha(theme.palette.common.white, 0.6), fontSize: '0.72rem', lineHeight: 1.4 }}>
        Top contributor:{' '}
        <Box component="span" sx={{ color: theme.palette.common.white, fontWeight: 700 }}>
          {leader.state}
        </Box>{' '}
        — {leader.total_acres.toLocaleString(undefined, { maximumFractionDigits: 0 })} acres
      </Typography>
    </Stack>
  );
}

// Crops ranking list for the Crops summary tile. Replaces the horizontal
// segmented bar so the Summary Metrics row doesn't read as "two cards
// with line charts." Each crop renders as its own row with the actual
// record count on the right — small classes (e.g. 17 records of "Wheat,
// Soft Winter") show their real number rather than rounding to "0%",
// which would mislead users into thinking those varieties are absent.
function CropsCompositionBar({ crops }) {
  const theme = useTheme();
  const items = useMemo(() => {
    if (!Array.isArray(crops)) return [];
    return crops
      .map((c) => ({
        name: typeof c === 'string' ? c : c?.crop_name,
        count: typeof c === 'object' ? Number(c?.count) || 0 : 0
      }))
      .filter((c) => c.name && c.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [crops]);
  if (items.length === 0) return null;
  // Each row rendered as a horizontal layout: tone-colored dot, crop
  // name (truncates with ellipsis when the column is narrow), record
  // count right-aligned with tabular numerals so the digits column-
  // align between rows. Ranked dot color signals the order without
  // needing a separate "1.", "2.", "3." numbering.
  const palette = [
    theme.palette.primary.main,
    theme.palette.primary.light,
    alpha(theme.palette.primary.light, 0.55)
  ];
  return (
    <Stack spacing={0.55}>
      {items.map((c, i) => (
        <Stack
          key={c.name}
          direction="row"
          spacing={0.75}
          sx={{
            alignItems: 'center',
            // Subtle separator between rows so the list reads as a
            // structured ranking rather than a free-flowing block of
            // text. Last row drops the border to avoid a visual "tail".
            pb: 0.5,
            borderBottom: i < items.length - 1 ? `1px solid ${alpha(theme.palette.primary.main, 0.15)}` : 'none'
          }}
        >
          <Box
            component="span"
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: palette[i % palette.length],
              flexShrink: 0
            }}
          />
          <Typography
            sx={{
              color: alpha(theme.palette.common.white, 0.88),
              fontSize: '0.75rem',
              fontWeight: 600,
              lineHeight: 1.3,
              flex: 1,
              minWidth: 0,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {formatCropName(c.name)}
          </Typography>
          <Typography
            sx={{
              color: theme.palette.common.white,
              fontSize: '0.85rem',
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.2,
              flexShrink: 0
            }}
          >
            {c.count.toLocaleString()}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

// Year-chip grid for the Seasons tile. Renders seasons in a 4-column
// grid (so 6–8 seasons read as a natural 2-row block) with chronological
// left-to-right ordering. Latest year is filled in primary tone to
// anchor "data is current through year X" at a glance; older seasons
// stay outlined-only.
function SeasonsRow({ seasons }) {
  const theme = useTheme();
  if (!Array.isArray(seasons) || seasons.length === 0) return null;
  const sorted = [...seasons].sort((a, b) => Number(a) - Number(b));
  const latest = Math.max(...seasons.map(Number).filter(Number.isFinite));
  return (
    <Box
      sx={{
        display: 'grid',
        // Fixed 4-column grid: 6 seasons fall into a 2-row layout (4 +
        // 2). Wider/narrower datasets still parse cleanly because each
        // pill is a fixed cell and rows wrap predictably.
        gridTemplateColumns: 'repeat(4, 1fr)',
        // Asymmetric gaps — tighter horizontal so the row of years
        // reads as a unit, more generous vertical so the second row
        // (current year + nearest neighbor) has clear breathing room
        // and doesn't visually crowd the first row.
        columnGap: 0.75,
        rowGap: 1.25
      }}
    >
      {sorted.map((year) => {
        const isLatest = Number(year) === latest;
        return (
          <Box
            key={year}
            sx={{
              // Larger pill geometry — chunkier vertical padding and a
              // slightly larger font than the previous inline-row
              // version so each year reads as a deliberate unit rather
              // than a tag.
              px: 1.25,
              py: 0.6,
              borderRadius: 1.5,
              fontSize: '0.85rem',
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '0.02em',
              textAlign: 'center',
              border: `1px solid ${isLatest ? theme.palette.primary.main : alpha(theme.palette.primary.main, 0.35)}`,
              bgcolor: isLatest ? alpha(theme.palette.primary.main, 0.35) : 'transparent',
              color: isLatest ? theme.palette.common.white : alpha(theme.palette.common.white, 0.78),
              lineHeight: 1.3
            }}
          >
            {year}
          </Box>
        );
      })}
    </Box>
  );
}

// Compact pill row of state abbreviations for the States tile. Mirrors
// the SeasonsRow shape (small primary-tinted pills) so the bottom row of
// metric tiles reads as a visually consistent family. Full names are
// shortened to USPS 2-letter abbreviations via US_STATES so the row fits
// comfortably in a 1/4-width tile even when 10+ states are present.
function StatesRow({ states, tooltipSlotProps }) {
  const theme = useTheme();
  const abbrLookup = useMemo(() => {
    const map = new Map();
    for (const entry of US_STATES) {
      if (entry?.name && entry?.abbr) map.set(entry.name.toLowerCase(), entry.abbr);
    }
    return map;
  }, []);
  if (!Array.isArray(states) || states.length === 0) return null;
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        columnGap: 0.75,
        rowGap: 1.25
      }}
    >
      {states.map((name) => {
        const abbr = abbrLookup.get(String(name).toLowerCase()) || String(name).slice(0, 2).toUpperCase();
        return (
          <Tooltip key={name} arrow placement="top" title={name} slotProps={tooltipSlotProps}>
            <Box
              sx={{
                px: 1.25,
                py: 0.6,
                borderRadius: 1.5,
                fontSize: '0.85rem',
                fontWeight: 700,
                letterSpacing: '0.02em',
                textAlign: 'center',
                border: `1px solid ${alpha(theme.palette.primary.main, 0.35)}`,
                bgcolor: 'transparent',
                color: alpha(theme.palette.common.white, 0.78),
                lineHeight: 1.3,
                cursor: 'default',
                transition: 'background 0.18s ease, border-color 0.18s ease, color 0.18s ease',
                '&:hover': {
                  bgcolor: alpha(theme.palette.primary.main, 0.18),
                  borderColor: alpha(theme.palette.primary.main, 0.7),
                  color: theme.palette.common.white
                }
              }}
            >
              {abbr}
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}

// Coverage progress bar for the Fields tile. Shows what % of the
// dataset's field-seasons have at least one model prediction attached.
// Color of the fill follows the same coverage-tier palette as the
// Prediction Coverage section further down the page (info → warning →
// success), so identical numbers look identical anywhere they appear.
function CoverageBar({ pct }) {
  const theme = useTheme();
  if (!Number.isFinite(pct)) return null;
  const tone =
    pct >= 90
      ? theme.palette.success.main
      : pct >= 75
        ? theme.palette.warning.main
        : theme.palette.info.main;
  return (
    <Stack spacing={0.6}>
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          height: 6,
          borderRadius: 999,
          overflow: 'hidden',
          bgcolor: alpha(theme.palette.common.black, 0.25)
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${Math.max(0, Math.min(100, pct))}%`,
            bgcolor: tone,
            transition: 'width 0.4s ease'
          }}
        />
      </Box>
      <Typography sx={{ color: alpha(theme.palette.common.white, 0.7), fontSize: '0.72rem', lineHeight: 1.4 }}>
        <Box component="span" sx={{ color: theme.palette.common.white, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {pct.toFixed(1)}%
        </Box>{' '}
        with predictions
      </Typography>
    </Stack>
  );
}

// Inline source-record callout for the Min/Max yield cards. Rendered
// below the headline number as a small "card within a card" so it
// reads as supporting provenance, not just another metric line.
//
// Color is the lever that ties this block to the headline number it
// explains: warning.light for the Min card (mirrors the "Low" bucket
// pin color), success.light for the Max card (mirrors "High"). The
// same tone is used for the left accent bar, the caption, and the
// field-number identifier, so a quick glance reads as "this is the
// LOW-yield record" without having to read the caption text.
//
// Layout, in order of identifiability:
// - Caption (uppercase, in tone) — explicitly directional ("Lowest-
//   yield field"), removing any ambiguity that this is *the* record
//   behind the headline number.
// - Field # + Season — bold, tabular numerals so digits column-align
//   between the Min and Max cards.
// - Location (county, state).
// - Crop + Variety (joined with ` · ` when both populated; routes
//   crop through `formatCropName` for the spring-wheat normalization).
// Acres is intentionally omitted to keep the callout compact — it's
// available via the FieldDetailDrawer when the user clicks through.
function SourceRecordInline({ record, tone, caption }) {
  const theme = useTheme();
  // Defaults so the component stays usable in any future "neutral"
  // context where there's no min/max polarity to convey.
  const accent = tone || theme.palette.primary.light;
  const label = caption || 'Source record';
  const captionStyle = {
    color: accent,
    fontWeight: 700,
    fontSize: '0.62rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase'
  };
  // Common visual frame for both the loaded and skeleton states so the
  // box's height + accent bar stay stable and the card doesn't reflow
  // when the API resolves.
  const frameSx = {
    position: 'relative',
    pl: 1.25,
    py: 0.5,
    borderLeft: `3px solid ${accent}`,
    borderRadius: '0 6px 6px 0',
    bgcolor: alpha(accent, 0.08)
  };
  if (!record) {
    return (
      <Box sx={frameSx}>
        <Stack spacing={0.4}>
          <Typography sx={captionStyle}>{label}</Typography>
          <Typography sx={{ color: alpha(theme.palette.common.white, 0.4), fontSize: '0.72rem', fontStyle: 'italic' }}>
            Loading…
          </Typography>
        </Stack>
      </Box>
    );
  }
  const fieldNumber = record.field_number != null ? `Field #${record.field_number}` : null;
  const season = record.season != null ? String(record.season) : null;
  const location = [record.county, record.state].filter(Boolean).join(', ');
  const cropDisplay = record.crop ? formatCropName(record.crop) : null;
  const variety = record.variety || null;
  // Year color — distinct from both the tone (which marks the field
  // identifier) and white (which marks "neutral" supporting text). Using
  // primary.light keeps the year visually anchored to the rest of the
  // page's primary-blue family without competing with the warning/success
  // tone that owns the field-number identifier on the same line.
  const seasonColor = theme.palette.primary.light;
  return (
    <Box sx={frameSx}>
      <Stack spacing={0.35}>
        <Typography sx={captionStyle}>{label}</Typography>
        {fieldNumber || season ? (
          <Typography
            sx={{
              fontWeight: 700,
              fontSize: '0.8rem',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.25
            }}
          >
            {fieldNumber ? (
              // Tone-colored field identifier ties this row to the
              // colored pin on the map and the colored bucket the
              // headline number falls into — three places, one color.
              <Box component="span" sx={{ color: accent }}>
                {fieldNumber}
              </Box>
            ) : null}
            {fieldNumber && season ? (
              <Box component="span" sx={{ color: alpha(theme.palette.common.white, 0.55), fontWeight: 500 }}>
                {' · '}
              </Box>
            ) : null}
            {season ? (
              <Box component="span" sx={{ color: seasonColor }}>
                {season}
              </Box>
            ) : null}
          </Typography>
        ) : null}
        {location ? (
          <Typography sx={{ color: alpha(theme.palette.common.white, 0.78), fontSize: '0.72rem', lineHeight: 1.35 }}>
            {location}
          </Typography>
        ) : null}
        {cropDisplay ? (
          <Typography sx={{ color: alpha(theme.palette.common.white, 0.78), fontSize: '0.72rem', lineHeight: 1.35 }}>
            {cropDisplay}
          </Typography>
        ) : null}
        {/* Variety on its own line. Always rendered as a labeled row so
            the user can immediately tell whether the source field has a
            recorded variety — when null we show "Not specified" rather
            than silently omitting the row, since "no variety logged" is
            itself meaningful provenance information. The label pill
            (lowercase "variety:") is dim so the value reads as the
            primary content. */}
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
          <Typography sx={{ color: alpha(theme.palette.common.white, 0.55), fontSize: '0.7rem', fontWeight: 600 }}>
            Variety:
          </Typography>
          <Typography
            sx={{
              color: variety ? theme.palette.common.white : alpha(theme.palette.common.white, 0.5),
              fontSize: '0.72rem',
              fontWeight: variety ? 600 : 500,
              fontStyle: variety ? 'normal' : 'italic',
              lineHeight: 1.35
            }}
          >
            {variety || 'Not specified'}
          </Typography>
        </Stack>
      </Stack>
    </Box>
  );
}

function MetricTile({ label, value, unit, helper, info, infoTooltipSlotProps, detail, hero = false }) {
  const theme = useTheme();
  return (
    <Paper
      variant="outlined"
      sx={{
        position: 'relative',
        overflow: 'hidden',
        // Hero tile gets extra breathing room and a subtle radial accent
        // so the eye lands on it first when scanning the row.
        p: hero ? { xs: 2.5, md: 3 } : 2.25,
        height: '100%',
        borderRadius: 2,
        // Match the "Deep Learning" pill palette next to the Field Performance
        // Records title — saturated primary surface with a half-alpha primary
        // border so all summary cards on this page read as a coherent
        // "primary" family alongside the pill.
        bgcolor: alpha(theme.palette.primary.main, hero ? 0.22 : 0.18),
        borderColor: alpha(theme.palette.primary.main, hero ? 0.65 : 0.5),
        // Hero tile has a faint top-right radial glow so it reads as the
        // headline metric even before the user parses the value. Other
        // tiles stay flat — adding the glow everywhere would dilute the
        // hierarchy back to "all cards equal weight."
        backgroundImage: hero
          ? `radial-gradient(120% 80% at 100% 0%, ${alpha(theme.palette.primary.main, 0.22)} 0%, transparent 65%)`
          : 'none',
        // Soft drop shadow so the card feels lifted off the page background.
        // Tuned for the dark theme — a near-black shadow at moderate alpha
        // reads as depth without competing with the primary-blue surface.
        boxShadow: hero
          ? `0 6px 20px ${alpha(theme.palette.common.black, 0.4)}`
          : `0 4px 14px ${alpha(theme.palette.common.black, 0.35)}`
      }}
    >
      <Stack spacing={hero ? 1.25 : 0.9}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Typography
            sx={{
              color: alpha(theme.palette.primary.light, 0.95),
              fontWeight: 700,
              fontSize: hero ? '0.78rem' : '0.72rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              lineHeight: 1.2
            }}
          >
            {label}
          </Typography>
          {info ? (
            <Tooltip arrow placement="top" slotProps={infoTooltipSlotProps} title={info}>
              <Box
                component="span"
                tabIndex={0}
                aria-label={`More information about ${label}`}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'help',
                  color: alpha(theme.palette.primary.light, 0.7),
                  transition: 'color 0.15s ease',
                  '&:hover, &:focus-visible': { color: theme.palette.primary.light, outline: 'none' }
                }}
              >
                <InfoCircleOutlined style={{ fontSize: '0.72rem' }} />
              </Box>
            </Tooltip>
          ) : null}
        </Stack>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline', flexWrap: 'wrap', rowGap: 0.25 }}>
          <Typography
            component="span"
            sx={{
              color: theme.palette.common.white,
              fontWeight: 700,
              // Hero gets a noticeably bigger value so the eye lands on
              // it first. Tabular numerals so digits column-align cleanly
              // (matters when the hero number is read alongside other
              // numbers below it, like a state-contribution percentage).
              fontSize: hero ? { xs: '2rem', md: '2.4rem' } : '1.6rem',
              lineHeight: 1.1,
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {value}
          </Typography>
          {unit ? (
            <Typography
              component="span"
              sx={{
                color: alpha(theme.palette.common.white, 0.6),
                fontWeight: 500,
                fontSize: hero ? '1rem' : '0.85rem'
              }}
            >
              {unit}
            </Typography>
          ) : null}
        </Stack>
        {helper ? (
          <Typography
            sx={{
              color: alpha(theme.palette.common.white, 0.55),
              fontWeight: 500,
              fontSize: '0.75rem',
              lineHeight: 1.4
            }}
          >
            {helper}
          </Typography>
        ) : null}
        {/* Structured footer block — used by the Min/Max yield cards to
            surface the actual DB row behind the headline number, and by
            the Avg card for parity. No hard divider here: the detail
            content itself owns its visual treatment (the source-record
            callout has a colored left-accent bar + tinted bg), and a
            top divider would conflict with that frame. */}
        {detail ? <Box sx={{ pt: 0.5 }}>{detail}</Box> : null}
      </Stack>
    </Paper>
  );
}

export default function Overview({ onNavigateToPredict }) {
  const theme = useTheme();
  const [overview, setOverview] = useState({
    total_field_seasons: 0,
    total_fields: 0,
    total_acres: 0,
    seasons_available: [],
    crops_available: [],
    yield_range: { min: 0, max: 0, avg: 0 },
    prediction_stats: {
      field_seasons_with_predictions: 0,
      total_predictions: 0,
      predicted_yield_avg: 0,
      predicted_yield_min: 0,
      predicted_yield_max: 0,
      field_predictions_total: 0,
      prediction_runs_total: 0
    }
  });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // Sample of fields for the hero map. Pulls a single page of the existing
  // /fields endpoint (which already returns lat/long per row) and uses up to
  // ~50 dots in the FieldMapPreview. We don't surface load errors here on
  // purpose — the map gracefully renders an empty silhouette if the fetch
  // fails, which is fine for a hero visual.
  const [mapFields, setMapFields] = useState([]);
  // Authoritative list of distinct states present in the field data,
  // pulled from /fields/states/ (which returns ALL states with at least one
  // field row, not just the 100-row mapFields sample). This is what
  // populates the banner's state dropdown so it always shows every state
  // the user could pick.
  const [dbStates, setDbStates] = useState([]);

  useEffect(() => {
    const controller = new AbortController();

    const loadOverview = async () => {
      setIsLoading(true);
      setLoadError('');
      try {
        const response = await fetch(`${API_BASE_URL}/fields/overview`, { signal: controller.signal });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to load overview (${response.status}): ${errorText}`);
        }

        const payload = await response.json();
        setOverview({
          total_field_seasons: payload?.total_field_seasons || 0,
          total_fields: payload?.total_fields || 0,
          total_acres: Number(payload?.total_acres) || 0,
          seasons_available: Array.isArray(payload?.seasons_available) ? payload.seasons_available : [],
          crops_available: Array.isArray(payload?.crops_available) ? payload.crops_available : [],
          yield_range: {
            min: Number(payload?.yield_range?.min) || 0,
            max: Number(payload?.yield_range?.max) || 0,
            avg: Number(payload?.yield_range?.avg) || 0
          },
          prediction_stats: {
            field_seasons_with_predictions: payload?.prediction_stats?.field_seasons_with_predictions || 0,
            total_predictions: payload?.prediction_stats?.total_predictions || 0,
            predicted_yield_avg: Number(payload?.prediction_stats?.predicted_yield_avg) || 0,
            predicted_yield_min: Number(payload?.prediction_stats?.predicted_yield_min) || 0,
            predicted_yield_max: Number(payload?.prediction_stats?.predicted_yield_max) || 0,
            field_predictions_total: payload?.prediction_stats?.field_predictions_total || 0,
            prediction_runs_total: payload?.prediction_stats?.prediction_runs_total || 0
          }
        });
      } catch (error) {
        if (error.name !== 'AbortError') {
          setLoadError(error.message || 'Failed to load overview metrics.');
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadOverview();

    return () => controller.abort();
  }, []);

  // Load a sample of fields with lat/long for the hero map. We fetch up to
  // 100 rows (the FieldMapPreview component picks the top 50 by acres) so
  // the map shows a representative geographic spread without a heavy
  // payload.
  useEffect(() => {
    const controller = new AbortController();
    const loadFields = async () => {
      try {
        // Bumped from 100 → 500 (the API cap) so the sample reliably
        // covers every state present in the dropdown. With 100, less-
        // represented states can be missing from the page entirely,
        // leaving the map without a pin for a state the user just picked.
        const response = await fetch(`${API_BASE_URL}/fields?limit=500`, { signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json();
        const rows = Array.isArray(payload?.data) ? payload.data : [];
        setMapFields(rows);
      } catch (error) {
        if (error.name !== 'AbortError') {
          // Silent: empty map silhouette is an acceptable fallback for the hero.
        }
      }
    };
    loadFields();
    return () => controller.abort();
  }, []);

  // Pull the full distinct-state list from /fields/states/. This is what
  // populates the banner's state dropdown — the 100-row mapFields sample
  // is too narrow (it might all happen to be Kansas), so we hit the
  // dedicated endpoint here for the authoritative list.
  useEffect(() => {
    const controller = new AbortController();
    const loadStates = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/fields/states/`, { signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json();
        const states = Array.isArray(payload)
          ? payload
              .map((entry) => (typeof entry === 'string' ? entry : entry?.state))
              .filter(Boolean)
          : [];
        setDbStates(states.sort());
      } catch (error) {
        if (error.name !== 'AbortError') {
          // Silent: dropdown will fall back to mapFields-derived list.
        }
      }
    };
    loadStates();
    return () => controller.abort();
  }, []);

  // Per-state aggregates from the API — count, total acres, avg yield,
  // distinct crops + varieties. Sourced from /fields/states/stats/ so
  // the map's hover popup shows real data for every state, not just
  // those that happen to be in the 500-row mapFields sample (which
  // skews heavily toward whichever state has the most rows).
  const [stateStats, setStateStats] = useState({});
  useEffect(() => {
    const controller = new AbortController();
    const loadStateStats = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/fields/states/stats/`, { signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json();
        if (!Array.isArray(payload)) return;
        const byName = {};
        payload.forEach((row) => {
          if (row?.state) byName[row.state] = row;
        });
        setStateStats(byName);
      } catch (error) {
        if (error.name !== 'AbortError') {
          // Silent: popup will fall back to mapFields-derived aggregates.
        }
      }
    };
    loadStateStats();
    return () => controller.abort();
  }, []);

  // Min/max yield extremes — actual DB rows behind the numbers shown on
  // the "Observed Yield Range" cards, used to populate the info-icon
  // tooltip on each card with real context (field number, crop, etc.).
  const [yieldExtremes, setYieldExtremes] = useState({ min: null, max: null });
  useEffect(() => {
    const controller = new AbortController();
    const loadYieldExtremes = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/fields/yield-extremes/`, { signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json();
        setYieldExtremes({
          min: payload?.min || null,
          max: payload?.max || null
        });
      } catch (error) {
        if (error.name !== 'AbortError') {
          // Silent: cards will show only the explanation text without row context.
        }
      }
    };
    loadYieldExtremes();
    return () => controller.abort();
  }, []);

  const predStats = overview.prediction_stats || {};
  const totalFieldSeasons = overview.total_field_seasons || 0;
  const withPredictions = predStats.field_seasons_with_predictions || 0;
  const coveragePct = totalFieldSeasons ? (100 * withPredictions) / totalFieldSeasons : 0;
  const cropsHelper = useMemo(() => {
    if (!Array.isArray(overview.crops_available)) return '';
    return overview.crops_available
      .map((crop) => (typeof crop === 'string' ? crop : crop?.crop_name))
      .filter(Boolean)
      .map(formatCropName)
      // Use a middle-dot separator instead of a comma. The crop names
      // themselves contain commas (e.g. "Wheat, Hard Winter"), so a
      // comma-joined list reads as "Wheat, Hard Winter, Wheat, Hard
      // Spring" — the boundary between two distinct crops blurs into
      // one ambiguous string. The dot keeps each crop name visually
      // self-contained.
      .join(' · ');
  }, [overview.crops_available]);

  // Time-aware greeting + formatted date for the hero eyebrow. Computed once
  // per mount; the page is rendered fresh on each navigation so we don't need
  // to keep this updating on a timer.
  const greeting = useMemo(() => getTimeOfDayGreeting(), []);
  const todayLabel = useMemo(() => new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }), []);

  // Default featured state — "United States" is the nationwide aggregate
  // and serves as the dropdown's default first option. The user can drill
  // into a specific state via the banner's dropdown.
  const defaultFeaturedState = 'United States';

  // States the user can choose from in the banner dropdown. "United States"
  // always pinned at the top as the aggregate option, followed by the
  // alphabetized list of distinct states actually present in the data
  // (sourced from /fields/states/ when available, falling back to the
  // mapFields sample during the initial load). We deliberately do NOT
  // filter by STATE_HARVEST_DATES — the harvest helpers fall back to
  // Kansas defaults for unknown states, so it's better to show the user
  // every state in their data than to silently hide some.
  const availableStates = useMemo(() => {
    let realStates;
    if (dbStates.length > 0) {
      realStates = dbStates;
    } else if (Array.isArray(mapFields) && mapFields.length > 0) {
      const fromMap = new Set();
      mapFields.forEach((f) => {
        if (f?.state) fromMap.add(f.state);
      });
      realStates = Array.from(fromMap).sort();
    } else {
      // Empty during the initial load — intentionally NOT falling back
      // to `Object.keys(STATE_HARVEST_DATES)` (the static list of every
      // wheat-growing state). That fallback briefly counted ~17 states,
      // which then snapped to the actual ~6 once /fields/states/
      // resolved, producing a visible "17 → 6" flicker on the legend
      // caption. Returning [] here means the legend simply doesn't show
      // a count until we have authoritative data.
      realStates = [];
    }
    return ['United States', ...realStates];
  }, [dbStates, mapFields]);

  // User-selected override for the state dropdown — falls back to the
  // computed default when null.
  const [stateOverride, setStateOverride] = useState(null);
  const featuredState = stateOverride || defaultFeaturedState;
  // Anchors for the two banner popovers: the info bubble next to the stage
  // detail, and the state dropdown menu.
  const [infoAnchor, setInfoAnchor] = useState(null);
  const [stateMenuAnchor, setStateMenuAnchor] = useState(null);

  // Wheat-stage info for the banner. Recomputed on every render so the
  // stage/days reflect "now" — cheap, no useMemo needed.
  const stageInfo = getWheatStage();
  const daysToHarvest = getDaysToHarvest(new Date(), featuredState);
  const seasonProgress = getSeasonProgress(new Date(), featuredState);

  // Human-friendly plant + harvest dates for the season-progress tooltip,
  // so the user can see exactly what window the percentage covers.
  const seasonWindow = useMemo(() => {
    const plant = STATE_PLANT_DATES[featuredState] || STATE_PLANT_DATES.Kansas;
    const harvest = STATE_HARVEST_DATES[featuredState] || STATE_HARVEST_DATES.Kansas;
    const fmt = (m, d) =>
      new Date(2000, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return { plantLabel: fmt(plant.month, plant.day), harvestLabel: fmt(harvest.month, harvest.day) };
  }, [featuredState]);

  // States the map should spotlight. "United States" lights up every
  // dropdown state at once; a specific pick narrows the map to only that
  // one. We slice off the leading "United States" entry so the highlight
  // set always represents real states, never the aggregate label.
  const highlightedStates = useMemo(() => {
    const realStates = availableStates.filter((s) => s !== 'United States');
    if (featuredState === 'United States') return realStates;
    return [featuredState];
  }, [featuredState, availableStates]);

  // Shared Tooltip styling so all hero tooltips read as part of the page's
  // Deep-Learning-pill family rather than the default neutral-gray MUI
  // tooltip. Surface uses the same color-mix tint as the Field Performance
  // Records card / state info popover; arrow inherits the same fill so it
  // continues the surface seamlessly.
  const themedTooltipBg = `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})`;
  const themedTooltipSlotProps = {
    tooltip: {
      sx: {
        bgcolor: themedTooltipBg,
        color: theme.palette.common.white,
        border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
        boxShadow: `0 6px 16px ${alpha(theme.palette.common.black, 0.45)}`,
        backgroundImage: 'none',
        fontSize: '0.78rem',
        fontWeight: 500,
        letterSpacing: '0.01em',
        px: 1.25,
        py: 0.85,
        borderRadius: 1,
        maxWidth: 280
      }
    },
    arrow: {
      sx: {
        color: themedTooltipBg,
        // The "&::before" trick re-tints the arrow's pseudo-element so the
        // inherited color picks up our themed bg rather than MUI's default
        // gray. Border on the arrow keeps the outline continuous with the
        // tooltip body's primary border.
        '&::before': {
          backgroundColor: themedTooltipBg,
          border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`
        }
      }
    }
  };

  // No title prop on MainCard — the parent tab is already named "Overview",
  // so a second header inside the card was redundant. MainCard skips the
  // CardHeader entirely when title is omitted.
  return (
    <MainCard>
      <Stack spacing={2.5}>
        <Paper
          variant="outlined"
          sx={{
            position: 'relative',
            overflow: 'hidden',
            borderColor: alpha(theme.palette.primary.main, 0.28),
            // Primary-only gradient mesh so the hero shares the same blue
            // family as the metric / coverage / table cards on the page
            // (the previous version mixed in success-green, which broke the
            // color story). Two radial glows + a directional linear, all
            // primary, with `background-size: 200%` giving the slow drift
            // animation room to travel.
            backgroundImage: `radial-gradient(120% 120% at 0% 0%, ${alpha(
              theme.palette.primary.main,
              0.28
            )} 0%, transparent 55%), radial-gradient(120% 120% at 100% 100%, ${alpha(
              theme.palette.primary.main,
              0.14
            )} 0%, transparent 60%), linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.2)} 0%, ${alpha(
              theme.palette.primary.main,
              0.04
            )} 55%, ${alpha(theme.palette.background.paper, 0.55)} 100%)`,
            backgroundSize: '200% 200%, 200% 200%, 100% 100%',
            backgroundPosition: '0% 50%, 100% 50%, 0% 0%',
            animation: 'heroShift 28s ease-in-out infinite',
            '@keyframes heroShift': {
              '0%, 100%': { backgroundPosition: '0% 50%, 100% 50%, 0% 0%' },
              '50%': { backgroundPosition: '100% 50%, 0% 50%, 0% 0%' }
            },
            // Soft drop shadow matching the rest of the page's cards.
            boxShadow: `0 6px 20px ${alpha(theme.palette.common.black, 0.4)}`
          }}
        >
          {/* Seasonal / growing-stage banner — strip across the top of the
              hero card. Anchors the page in time: "this is a living crop,
              not a static dataset". The thin progress bar visualizes how
              far we are through the planting → harvest cycle for the
              featured state (chosen from the actual data when possible). */}
          <Box
            sx={{
              px: { xs: 2, md: 3 },
              py: 1.25,
              borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.28)}`,
              bgcolor: alpha(theme.palette.primary.main, 0.12)
            }}
          >
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'nowrap', minWidth: 0 }}>
              {/* "Currently in" stage indicator with a pulsing dot to
                  emphasize that this is a live state, not a label. */}
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                <Box
                  component="span"
                  aria-hidden
                  sx={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    bgcolor: theme.palette.success.main,
                    boxShadow: `0 0 0 0 ${alpha(theme.palette.success.main, 0.55)}`,
                    animation: 'stagePulse 2.4s ease-in-out infinite',
                    '@keyframes stagePulse': {
                      '0%, 100%': { boxShadow: `0 0 0 0 ${alpha(theme.palette.success.main, 0.55)}` },
                      '50%': { boxShadow: `0 0 0 6px ${alpha(theme.palette.success.main, 0)}` }
                    },
                    flexShrink: 0
                  }}
                />
                <Typography
                  sx={{
                    color: alpha(theme.palette.common.white, 0.55),
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase'
                  }}
                >
                  Currently
                </Typography>
                <Typography
                  sx={{
                    color: theme.palette.common.white,
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    letterSpacing: '0.01em'
                  }}
                >
                  {stageInfo.label}
                </Typography>
                <Typography
                  sx={{
                    color: alpha(theme.palette.common.white, 0.55),
                    fontSize: '0.78rem',
                    fontWeight: 500,
                    // Hidden until lg so the banner never has to wrap a
                    // long stage detail (e.g. "Hard dough · ready to
                    // combine") onto a second line when the drawer is open.
                    display: { xs: 'none', lg: 'inline' },
                    whiteSpace: 'nowrap'
                  }}
                >
                  · {stageInfo.detail}
                </Typography>
                {/* Info button — click pops a small Popover with a longer
                    explanation of the current stage and a "Learn more" link
                    to a reputable agronomy reference. We use Popover (not
                    Tooltip) so the link inside is actually clickable. */}
                <Tooltip title="More about this stage" arrow slotProps={themedTooltipSlotProps}>
                  <IconButton
                    size="small"
                    onClick={(e) => setInfoAnchor(e.currentTarget)}
                    sx={{
                      ml: 0.25,
                      color: alpha(theme.palette.primary.light, 0.85),
                      p: 0.4,
                      '&:hover': {
                        color: theme.palette.primary.light,
                        bgcolor: alpha(theme.palette.primary.main, 0.18)
                      }
                    }}
                    aria-label={`More about the ${stageInfo.label} stage`}
                  >
                    <InfoCircleOutlined style={{ fontSize: '0.85rem' }} />
                  </IconButton>
                </Tooltip>
              </Stack>
              {/* Spacer pushes the right cluster to the far edge on wide
                  screens. The whole row is locked to nowrap so a narrowed
                  viewport (e.g. drawer open) never bumps the right
                  cluster onto a second line — instead the spacer
                  collapses and the secondary text inside each cluster is
                  hidden via `display: { xs: 'none' }` rules below. */}
              <Box sx={{ flex: 1, minWidth: 0 }} />
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'nowrap', flexShrink: 0 }}>
                <Stack
                  direction="row"
                  spacing={0.75}
                  sx={{ alignItems: 'center', color: alpha(theme.palette.common.white, 0.78), fontSize: '0.8rem' }}
                >
                  <Typography component="span" sx={{ fontSize: 'inherit', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    <Box component="span" sx={{ color: theme.palette.primary.light, fontWeight: 700 }}>
                      {daysToHarvest}
                    </Box>{' '}
                    days to harvest in
                  </Typography>
                  {/* State picker — replaces the static "Kansas" with a
                      dropdown of states actually present in the field data
                      (and that we have a known harvest date for). Defaults
                      to the most-represented state; user pick is sticky for
                      the session via stateOverride. */}
                  <Button
                    size="small"
                    onClick={(e) => setStateMenuAnchor(e.currentTarget)}
                    endIcon={<DownOutlined style={{ fontSize: '0.62rem' }} />}
                    sx={{
                      // Hover behavior mirrors the Model selection pill in
                      // FieldTable: identical 4-property transition (bg,
                      // border, box-shadow, color) and a 2px primary halo
                      // on hover so the affordance reads consistently
                      // across the page's pill family.
                      textTransform: 'none',
                      fontWeight: 700,
                      fontSize: '0.8rem',
                      letterSpacing: '0.01em',
                      minHeight: 0,
                      whiteSpace: 'nowrap',
                      py: 0.15,
                      px: 0.85,
                      borderRadius: 999,
                      color: alpha(theme.palette.primary.light, 0.95),
                      bgcolor: alpha(theme.palette.primary.main, 0.18),
                      border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
                      transition:
                        'background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease',
                      '&:hover': {
                        color: theme.palette.common.white,
                        bgcolor: alpha(theme.palette.primary.main, 0.32),
                        borderColor: theme.palette.primary.main,
                        boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.18)}`
                      }
                    }}
                  >
                    {featuredState}
                  </Button>
                </Stack>
                {/* Season-progress bar + clarified label. The percentage now
                    reads "X% through season" with a Tooltip on the whole
                    cluster explaining the actual planting → harvest dates
                    that the bar measures against. */}
                <Tooltip
                  arrow
                  slotProps={themedTooltipSlotProps}
                  title={
                    <Box sx={{ p: 0.25 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.25, color: 'inherit' }}>
                        Season progress
                      </Typography>
                      <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.45, color: 'inherit' }}>
                        How far {featuredState} winter wheat is through its
                        planting → harvest cycle right now.
                      </Typography>
                      <Typography sx={{ fontSize: '0.7rem', mt: 0.5, opacity: 0.85, color: 'inherit' }}>
                        Plant ≈ {seasonWindow.plantLabel} · Harvest ≈ {seasonWindow.harvestLabel}
                      </Typography>
                    </Box>
                  }
                >
                  <Stack
                    direction="row"
                    spacing={0.75}
                    sx={{
                      alignItems: 'center',
                      cursor: 'help',
                      // Drop the progress bar entirely on narrow widths
                      // (e.g. drawer-open). The "days to harvest"
                      // headline still tells the user where they are in
                      // the season, and the bar reappears at md+.
                      display: { xs: 'none', md: 'flex' }
                    }}
                  >
                    <Box
                      sx={{
                        width: { xs: 80, sm: 120 },
                        height: 4,
                        borderRadius: 2,
                        bgcolor: alpha(theme.palette.primary.main, 0.22),
                        overflow: 'hidden',
                        position: 'relative'
                      }}
                    >
                      <Box
                        sx={{
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: `${seasonProgress}%`,
                          background: `linear-gradient(90deg, ${theme.palette.primary.main} 0%, ${theme.palette.success.light} 100%)`,
                          transition: 'width 0.6s ease'
                        }}
                      />
                    </Box>
                    <Typography
                      sx={{
                        color: alpha(theme.palette.common.white, 0.7),
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {Math.round(seasonProgress)}% through season
                    </Typography>
                  </Stack>
                </Tooltip>
              </Stack>
            </Stack>
          </Box>

          {/* Stage-info popover — opened by the (i) icon in the banner. */}
          <Popover
            open={Boolean(infoAnchor)}
            anchorEl={infoAnchor}
            onClose={() => setInfoAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            slotProps={{
              paper: {
                sx: {
                  bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})`,
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
                  borderRadius: 1.25,
                  backgroundImage: 'none',
                  maxWidth: 360,
                  mt: 0.5,
                  boxShadow: `0 8px 22px ${alpha(theme.palette.common.black, 0.45)}`
                }
              }
            }}
          >
            <Box sx={{ p: 2 }}>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                <Typography sx={{ color: theme.palette.common.white, fontWeight: 700, fontSize: '0.95rem' }}>
                  {stageInfo.label}
                </Typography>
                <Typography sx={{ color: alpha(theme.palette.common.white, 0.7), fontSize: '0.78rem' }}>
                  · {stageInfo.detail}
                </Typography>
              </Stack>
              <Typography
                sx={{
                  color: alpha(theme.palette.common.white, 0.85),
                  fontSize: '0.82rem',
                  lineHeight: 1.55,
                  mt: 1
                }}
              >
                {stageInfo.description}
              </Typography>
              {stageInfo.link ? (
                <Box sx={{ mt: 1.25 }}>
                  <Box
                    component="a"
                    href={stageInfo.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.5,
                      color: theme.palette.primary.light,
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      textDecoration: 'none',
                      letterSpacing: '0.02em',
                      '&:hover': {
                        color: theme.palette.common.white,
                        textDecoration: 'underline'
                      }
                    }}
                  >
                    Learn more →
                  </Box>
                </Box>
              ) : null}
            </Box>
          </Popover>

          {/* State picker menu — opens from the dropdown button in the banner. */}
          <Menu
            anchorEl={stateMenuAnchor}
            open={Boolean(stateMenuAnchor)}
            onClose={() => setStateMenuAnchor(null)}
            slotProps={{
              paper: {
                sx: {
                  bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 8%, ${theme.palette.background.paper})`,
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.4)}`,
                  borderRadius: 1.25,
                  backgroundImage: 'none',
                  mt: 0.5,
                  maxHeight: 320,
                  '& .MuiMenuItem-root': {
                    color: alpha(theme.palette.common.white, 0.88),
                    fontSize: '0.85rem',
                    minHeight: 32,
                    '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.16) },
                    '&.Mui-selected': {
                      bgcolor: alpha(theme.palette.primary.main, 0.28),
                      '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.36) }
                    }
                  }
                }
              }
            }}
          >
            {availableStates.map((state) => (
              <MenuItem
                key={state}
                selected={state === featuredState}
                onClick={() => {
                  setStateOverride(state);
                  setStateMenuAnchor(null);
                }}
              >
                {state}
              </MenuItem>
            ))}
          </Menu>

          <Grid container spacing={0}>
            <Grid size={{ xs: 12, md: 7 }}>
              <Stack spacing={2} sx={{ p: { xs: 2.5, md: 3.5 } }}>
                <Stack spacing={0.4}>
                  {/* Eyebrow — brand line + today's date so the page reads
                      as fresh and contextual on every visit. */}
                  <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                    <Typography
                      sx={{
                        color: alpha(theme.palette.primary.light, 0.95),
                        fontWeight: 700,
                        fontSize: '0.72rem',
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase'
                      }}
                    >
                      Wheat Trait Intelligence
                    </Typography>
                    <Box
                      component="span"
                      aria-hidden
                      sx={{
                        width: 4,
                        height: 4,
                        borderRadius: '50%',
                        bgcolor: alpha(theme.palette.primary.light, 0.5),
                        display: 'inline-block'
                      }}
                    />
                    <Typography
                      sx={{
                        color: alpha(theme.palette.common.white, 0.6),
                        fontSize: '0.72rem',
                        fontWeight: 500,
                        letterSpacing: '0.04em'
                      }}
                    >
                      {todayLabel}
                    </Typography>
                  </Stack>
                  {/* Time-aware personalized greeting — the hero's emotional
                      anchor. Reads as "this product knows you" rather than
                      a generic banner. */}
                  <Typography
                    variant="h3"
                    sx={{
                      color: theme.palette.common.white,
                      fontWeight: 700,
                      letterSpacing: '-0.01em',
                      lineHeight: 1.15
                    }}
                  >
                    {greeting}, {USER_NAME}
                  </Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 560 }}>
                  Track crop performance, model coverage, and yield signals in one view. This dashboard blends observed field outcomes with
                  machine-learning predictions to help prioritize decisions quickly.
                </Typography>
                {/* Primary CTA — gives the hero a single, unambiguous action.
                    Jumps to the Predict tab via the callback passed down from
                    the page shell. Styled to match the page's primary-tinted
                    pill family (state picker / model selection chip) so it
                    reads as the same affordance vocabulary. */}
                {onNavigateToPredict ? (
                  <Box>
                    <Button
                      onClick={onNavigateToPredict}
                      endIcon={<RightOutlined style={{ fontSize: '0.7rem' }} />}
                      sx={{
                        textTransform: 'none',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        letterSpacing: '0.01em',
                        py: 0.85,
                        px: 2,
                        borderRadius: 999,
                        color: theme.palette.common.white,
                        bgcolor: alpha(theme.palette.primary.main, 0.55),
                        border: `1px solid ${alpha(theme.palette.primary.main, 0.7)}`,
                        boxShadow: `0 2px 8px ${alpha(theme.palette.primary.main, 0.35)}`,
                        transition:
                          'background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease',
                        '&:hover': {
                          bgcolor: theme.palette.primary.main,
                          borderColor: theme.palette.primary.main,
                          boxShadow: `0 4px 14px ${alpha(theme.palette.primary.main, 0.5)}`,
                          transform: 'translateY(-1px)'
                        }
                      }}
                    >
                      Run a Prediction
                    </Button>
                  </Box>
                ) : null}
              </Stack>
            </Grid>
            <Grid size={{ xs: 12, md: 5 }}>
              {/* Field map — real US states SVG with pins on states that
                  have field data. Tighter padding here than the previous
                  iteration so the map fills the column rather than floating
                  in whitespace. */}
              <Box
                sx={{
                  position: 'relative',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  px: { xs: 1.5, md: 1 },
                  py: { xs: 1, md: 1.5 },
                  height: '100%'
                }}
              >
                <FieldMapPreview
                  fields={mapFields}
                  yieldRange={overview.yield_range}
                  highlightedStates={highlightedStates}
                  stateStats={stateStats}
                />
              </Box>
            </Grid>
          </Grid>
        </Paper>

        <Stack spacing={0.75}>
          <Typography variant="h5">Summary Metrics</Typography>

          {loadError ? (
            <Typography variant="caption" color="error.main">
              {loadError}
            </Typography>
          ) : null}
          {isLoading ? (
            <Typography variant="caption" color="text.secondary">
              Loading overview metrics...
            </Typography>
          ) : null}
        </Stack>

        <Grid container spacing={2}>
          {/* Hero row — Total Acres takes the full width on md+ so it
              reads as the section's headline KPI. The three dimensional
              tiles sit beneath at equal weight. On smaller breakpoints
              everything stacks. */}
          <Grid size={{ xs: 12 }}>
            <MetricTile
              hero
              label="Total Acres"
              value={overview.total_acres.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              unit="acres"
              detail={
                <AcresStateBreakdown stateStats={stateStats} totalAcres={overview.total_acres} />
              }
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <MetricTile
              label="Fields"
              value={overview.total_fields.toLocaleString()}
              helper="Distinct field IDs in the system"
              infoTooltipSlotProps={themedTooltipSlotProps}
              info={
                <Box sx={{ p: 0.25 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.25, color: 'inherit' }}>
                    Field records
                  </Typography>
                  <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.45, color: 'inherit' }}>
                    Each record is a <strong>field-season</strong> — one
                    field tracked across one growing season. The number
                    here counts every distinct field-season in the
                    database.
                  </Typography>
                  <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.45, color: 'inherit', mt: 0.6 }}>
                    A field record <strong>has a prediction</strong> when
                    at least one ML model has produced a yield estimate
                    for it. The percentage below shows how much of your
                    dataset has been scored by our models — higher
                    coverage means more rows are ready for analysis,
                    comparison, and downstream reporting.
                  </Typography>
                </Box>
              }
              detail={<CoverageBar pct={coveragePct} />}
            />
          </Grid>
          {/* States tile — pairs with Fields to surface geographic
              breadth: "X fields across Y states." Helper text under
              the value reinforces the relational framing without
              duplicating the field count from the Fields tile. */}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <MetricTile
              label="States"
              value={String(dbStates.length)}
              detail={<StatesRow states={dbStates} tooltipSlotProps={themedTooltipSlotProps} />}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <MetricTile
              label="Seasons"
              value={String(overview.seasons_available.length)}
              detail={<SeasonsRow seasons={overview.seasons_available} />}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <MetricTile
              label="Crops"
              value={String(overview.crops_available.length)}
              detail={<CropsCompositionBar crops={overview.crops_available} />}
            />
          </Grid>
        </Grid>

        <Divider />

        <Stack spacing={1.5}>
          <Typography variant="h5">Observed Yield Range</Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 4 }}>
              <MetricTile
                label="Min Yield"
                value={overview.yield_range.min.toFixed(1)}
                unit="bu/ac"
                infoTooltipSlotProps={themedTooltipSlotProps}
                info={
                  <Box sx={{ p: 0.25 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.25, color: 'inherit' }}>
                      Min Yield
                    </Typography>
                    <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.45, color: 'inherit' }}>
                      The lowest single-field yield recorded in the database
                      across every harvested field-season. Source row shown
                      on the card; acres available in the{' '}
                      <FieldDetailViewLink />.
                    </Typography>
                  </Box>
                }
                detail={
                  <SourceRecordInline
                    record={yieldExtremes.min}
                    tone={theme.palette.warning.light}
                    caption="Lowest-yield field"
                  />
                }
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <MetricTile
                label="Avg Yield"
                value={overview.yield_range.avg.toFixed(1)}
                unit="bu/ac"
                infoTooltipSlotProps={themedTooltipSlotProps}
                info={
                  <Box sx={{ p: 0.25 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.25, color: 'inherit' }}>
                      Avg Yield
                    </Typography>
                    <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.45, color: 'inherit' }}>
                      Computed by summing every observed yield value in the
                      database and dividing by the total number of records.
                    </Typography>
                  </Box>
                }
                detail={
                  // Parity callout for the Avg card — same colored-frame
                  // pattern as the Min/Max source records so the three
                  // cards read as a visually consistent set. Primary tone
                  // here matches the "Medium" yield bucket (the legend dot
                  // for the avg-band on the map), continuing the color-
                  // coded relationship between headline numbers and the
                  // bucket they belong to.
                  <Box
                    sx={{
                      pl: 1.25,
                      py: 0.5,
                      borderLeft: `3px solid ${theme.palette.primary.light}`,
                      borderRadius: '0 6px 6px 0',
                      bgcolor: alpha(theme.palette.primary.light, 0.08)
                    }}
                  >
                    <Stack spacing={0.35}>
                      <Typography
                        sx={{
                          color: theme.palette.primary.light,
                          fontWeight: 700,
                          fontSize: '0.62rem',
                          letterSpacing: '0.1em',
                          textTransform: 'uppercase'
                        }}
                      >
                        Computation
                      </Typography>
                      <Typography
                        sx={{
                          fontWeight: 700,
                          fontSize: '0.8rem',
                          fontVariantNumeric: 'tabular-nums',
                          lineHeight: 1.25
                        }}
                      >
                        <Box component="span" sx={{ color: theme.palette.primary.light }}>
                          {(overview.total_field_seasons || 0).toLocaleString()}
                        </Box>{' '}
                        <Box component="span" sx={{ color: alpha(theme.palette.common.white, 0.85) }}>
                          records
                        </Box>
                      </Typography>
                      <Typography sx={{ color: alpha(theme.palette.common.white, 0.7), fontSize: '0.72rem', lineHeight: 1.35 }}>
                        Sum of all observed yields ÷ record count
                      </Typography>
                    </Stack>
                  </Box>
                }
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <MetricTile
                label="Max Yield"
                value={overview.yield_range.max.toFixed(1)}
                unit="bu/ac"
                infoTooltipSlotProps={themedTooltipSlotProps}
                info={
                  <Box sx={{ p: 0.25 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.25, color: 'inherit' }}>
                      Max Yield
                    </Typography>
                    <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.45, color: 'inherit' }}>
                      The highest single-field yield recorded in the database
                      across every harvested field-season. Source row shown
                      on the card; acres available in the{' '}
                      <FieldDetailViewLink />.
                    </Typography>
                  </Box>
                }
                detail={
                  <SourceRecordInline
                    record={yieldExtremes.max}
                    tone={theme.palette.success.light}
                    caption="Highest-yield field"
                  />
                }
              />
            </Grid>
          </Grid>
        </Stack>

        <Divider />

        {/* Prediction Statistics moved → Analytics tab as the new
            "Model Performance" macro-view card. Overview now stays focused
            on observed/field-grounded data; Analytics owns the
            model-output story end-to-end (macro stats → prediction list →
            per-prediction analysis). */}

        {/* Simplified field-records table for the Overview tab. The
            chevron stays so users can drill into a row's full details.
            The model-toggle pill and the Predicted Yield column are
            both hidden — Overview is an "observed reality" view; the
            model-prediction lens lives over on the Analytics tab. The
            `id` is the smooth-scroll anchor used by the min/max yield
            tooltips' "field detail view" links. */}
        <FieldTable
          id="overview-field-records"
          showModelSelector={false}
          showPredictedYieldColumn={false}
          banner={<OverviewTableBanner />}
        />
      </Stack>
    </MainCard>
  );
}
