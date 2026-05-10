import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';

import { US_STATES, US_VIEWBOX } from 'sections/intelligence/crop-studio/usStatesPaths';
import { formatCropName, formatCropNames } from 'utils/cropName';

// Roll up the field rows into per-state aggregates: count, total acres, and
// average OBSERVED yield (sum of yield_bu_ac / count of fields with a
// reading). We use observed yield because (a) it's directly populated by
// harvested fields without needing a prediction, and (b) the previous
// `regional_avg_yield` source was null for most rows, leaving the map
// without color information. Null/undefined yields are filtered out
// explicitly so they don't get coerced to 0 by Number(null) and skew the
// average toward zero.
function aggregateByState(fields) {
  const byState = new Map();
  for (const field of fields) {
    if (!field?.state) continue;
    if (!byState.has(field.state)) {
      byState.set(field.state, {
        state: field.state,
        count: 0,
        totalAcres: 0,
        yields: [],
        // Sets so we naturally dedupe when the same crop / variety
        // appears across multiple field rows in the same state.
        crops: new Set(),
        varieties: new Set()
      });
    }
    const entry = byState.get(field.state);
    entry.count += 1;
    const acres = Number(field.acres);
    if (Number.isFinite(acres)) entry.totalAcres += acres;
    // Explicit null/undefined check — Number(null) === 0, which would
    // silently push zeros into the average and pull the mean to nothing.
    if (field.yield_bu_ac !== null && field.yield_bu_ac !== undefined && field.yield_bu_ac !== '') {
      const observed = Number(field.yield_bu_ac);
      if (Number.isFinite(observed) && observed > 0) entry.yields.push(observed);
    }
    if (field.crop) entry.crops.add(field.crop);
    if (field.variety) entry.varieties.add(field.variety);
  }
  const out = {};
  for (const [name, e] of byState) {
    out[name] = {
      ...e,
      avgYield: e.yields.length > 0 ? e.yields.reduce((a, b) => a + b, 0) / e.yields.length : null,
      crops: Array.from(e.crops).sort(),
      varieties: Array.from(e.varieties).sort()
    };
  }
  return out;
}

// Map a yield value to a tone bucket using the page's actual yield_range
// (min/max from the overview API) as the bucket boundaries — colors here
// agree with the Observed Yield Range section on the same page. Splits the
// range into thirds.
function getYieldTone(value, yieldRange, theme) {
  if (!Number.isFinite(value)) return theme.palette.primary.light;
  const min = Number(yieldRange?.min);
  const max = Number(yieldRange?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return theme.palette.primary.light;
  }
  const lowCut = min + (max - min) / 3;
  const highCut = min + (2 * (max - min)) / 3;
  if (value < lowCut) return theme.palette.warning.light;
  if (value < highCut) return theme.palette.primary.light;
  return theme.palette.success.light;
}

function getYieldBucketLabel(value, yieldRange) {
  if (!Number.isFinite(value)) return 'No yield data';
  const min = Number(yieldRange?.min);
  const max = Number(yieldRange?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 'Mid range';
  const lowCut = min + (max - min) / 3;
  const highCut = min + (2 * (max - min)) / 3;
  if (value < lowCut) return 'Low range';
  if (value < highCut) return 'Mid range';
  return 'High range';
}

export default function FieldMapPreview({
  fields = [],
  yieldRange = { min: 0, max: 0, avg: 0 },
  // States to spotlight on the map. Authoritative source of truth for
  // which states render highlighted (saturated fill + pin) — driven from
  // the dropdown selection, NOT from whether the row sample happens to
  // include that state. `null`/undefined falls back to "every state with
  // data is highlighted" for backwards compatibility.
  highlightedStates = null,
  // Authoritative count for the "X states with data" legend caption.
  // The page-level `dbStates` list (from /fields/states/) is the right
  // source — the local `mapFields` sample only covers a slice of the DB
  // and would undercount otherwise. Falls back to the locally-aggregated
  // count when not provided.
  totalStatesCount = null,
  // Pre-computed per-state aggregates from /fields/states/stats/. Keyed
  // by state name. When present, takes precedence over the locally
  // aggregated `fields` sample for the hover popup so every state shows
  // real data — not just the few that happen to be in the row sample.
  stateStats = null
}) {
  const theme = useTheme();
  // Local sample-derived aggregate is kept as a fallback for the rare
  // case where the server stats haven't loaded yet.
  const localAggregates = useMemo(() => aggregateByState(fields), [fields]);
  // Merge: server stats win when present, local aggregates fill any
  // gaps. Both sources expose the same shape (count, totalAcres,
  // avgYield, crops, varieties) so the popup renders identically
  // regardless of which one provided the row.
  const stateAggregates = useMemo(() => {
    const out = { ...localAggregates };
    if (stateStats && typeof stateStats === 'object') {
      for (const [name, row] of Object.entries(stateStats)) {
        if (!row) continue;
        out[name] = {
          state: name,
          count: Number(row.count) || 0,
          totalAcres: Number(row.total_acres) || 0,
          avgYield: row.avg_yield != null ? Number(row.avg_yield) : null,
          crops: Array.isArray(row.crops) ? row.crops : [],
          varieties: Array.isArray(row.varieties) ? row.varieties : []
        };
      }
    }
    return out;
  }, [localAggregates, stateStats]);
  const highlightSet = useMemo(
    () => (Array.isArray(highlightedStates) ? new Set(highlightedStates) : null),
    [highlightedStates]
  );
  const isHighlighted = (name) => (highlightSet ? highlightSet.has(name) : Boolean(stateAggregates[name]));
  // A single-state selection (size === 1) gets the pulsing pin; the
  // "United States" all-states view stays quiet so 6 simultaneously
  // pulsing dots don't read as alarmist noise.
  const isSingleSelection = highlightSet?.size === 1;
  const legendStateCount = Number.isFinite(totalStatesCount) && totalStatesCount > 0
    ? totalStatesCount
    : Object.keys(stateAggregates).length;
  // Hover state — drives the floating tooltip overlay near the cursor.
  const [hover, setHover] = useState({ name: null, x: 0, y: 0 });

  // Yield-range bucket boundaries for the legend strip.
  const bucketLabels = useMemo(() => {
    const min = Number(yieldRange?.min);
    const max = Number(yieldRange?.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      return { low: '< low', mid: 'mid', high: '> high' };
    }
    const lowCut = min + (max - min) / 3;
    const highCut = min + (2 * (max - min)) / 3;
    return {
      low: `${min.toFixed(0)}–${lowCut.toFixed(0)}`,
      mid: `${lowCut.toFixed(0)}–${highCut.toFixed(0)}`,
      high: `${highCut.toFixed(0)}–${max.toFixed(0)}`
    };
  }, [yieldRange]);

  const handlePointerMove = (event, name) => {
    setHover({ name, x: event.clientX, y: event.clientY });
  };
  const handlePointerLeave = () => setHover({ name: null, x: 0, y: 0 });

  const hoveredAggregate = hover.name ? stateAggregates[hover.name] : null;

  return (
    <Stack spacing={1.25} sx={{ height: '100%', width: '100%', justifyContent: 'center' }}>
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          filter: `drop-shadow(0 6px 14px ${alpha(theme.palette.common.black, 0.3)})`
        }}
      >
        <Box
          component="svg"
          viewBox={`0 0 ${US_VIEWBOX.width} ${US_VIEWBOX.height}`}
          sx={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
          aria-label="Map of US states with field locations"
          role="img"
        >
          {/* State silhouettes — every state gets a path. Highlighted
              states (driven by the dropdown) get the saturated primary
              fill; everything else fades into the background. Membership
              in the highlight set is independent of whether the row
              sample contains data for that state, so a freshly-picked
              state with no sampled rows still reads as "in focus". */}
          {US_STATES.map((state) => {
            const data = stateAggregates[state.name];
            const hasData = Boolean(data);
            const inFocus = isHighlighted(state.name);
            const isHovered = hover.name === state.name;
            // Hover (and the resulting popup + bright border) is gated
            // strictly to highlighted states. Single-state mode locks
            // hover to that one state; "United States" mode opens it up
            // to every dropdown state. Non-highlighted states are inert.
            const hoverable = inFocus;

            let fill;
            let stroke;
            let strokeWidth;
            if (inFocus && isHovered) {
              // Pop the border color and width when the user hovers the
              // state so it reads as "selected" — the visual handshake
              // that pairs with the popup appearing.
              fill = alpha(theme.palette.primary.main, 0.55);
              stroke = theme.palette.primary.light;
              strokeWidth = 2.5;
            } else if (inFocus) {
              fill = alpha(theme.palette.primary.main, 0.45);
              stroke = theme.palette.primary.light;
              strokeWidth = 1.6;
            } else {
              fill = alpha(theme.palette.primary.main, hasData ? 0.08 : 0.04);
              stroke = alpha(theme.palette.primary.light, hasData ? 0.32 : 0.22);
              strokeWidth = 0.7;
            }

            return (
              <path
                key={state.abbr}
                d={state.d}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeLinejoin="round"
                style={{
                  cursor: hoverable ? 'pointer' : 'default',
                  // Inert states ignore pointer events entirely so the
                  // hover popup never opens for a non-highlighted state.
                  pointerEvents: hoverable ? 'auto' : 'none',
                  transition: 'fill 0.18s ease, stroke 0.18s ease, stroke-width 0.18s ease'
                }}
                onMouseEnter={hoverable ? (e) => handlePointerMove(e, state.name) : undefined}
                onMouseMove={hoverable ? (e) => handlePointerMove(e, state.name) : undefined}
                onMouseLeave={hoverable ? handlePointerLeave : undefined}
              />
            );
          })}

          {/* Pin markers — only on highlighted states. Static dot tinted
              to the state's bu/ac yield bucket. The pulsing ring (when a
              single state is selected) is drawn in a separate pass below
              so it always renders on top of all pins. */}
          {US_STATES.map((state) => {
            if (!isHighlighted(state.name)) return null;
            const data = stateAggregates[state.name];
            const tone = data ? getYieldTone(data.avgYield, yieldRange, theme) : theme.palette.primary.light;
            const [cx, cy] = state.centroid;
            const isHovered = hover.name === state.name;
            const r = isHovered ? 5.5 : 4.5;
            return (
              <g
                key={`pin-${state.abbr}`}
                transform={`translate(${cx},${cy})`}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) => handlePointerMove(e, state.name)}
                onMouseMove={(e) => handlePointerMove(e, state.name)}
                onMouseLeave={handlePointerLeave}
              >
                <circle r={r} fill={tone} stroke={alpha(theme.palette.common.white, 0.9)} strokeWidth={isHovered ? 1.6 : 1} />
              </g>
            );
          })}

          {/* Pulse ring — single-state selection only. Drawn AFTER all
              pins so it always sits on top (rather than getting hidden
              by the solid pin underneath when its r overlaps). The ring
              starts visible *outside* the pin's edge (r+1 → r+8) and
              fades opacity 0.7 → 0 over 2.4s, mirroring the box-shadow
              pulse of the "CURRENTLY" dot in the banner. */}
          {isSingleSelection
            ? US_STATES.map((state) => {
                if (!isHighlighted(state.name)) return null;
                const data = stateAggregates[state.name];
                const tone = data ? getYieldTone(data.avgYield, yieldRange, theme) : theme.palette.primary.light;
                const [cx, cy] = state.centroid;
                const baseR = 4.5;
                return (
                  <circle
                    key={`pulse-${state.abbr}`}
                    cx={cx}
                    cy={cy}
                    r={baseR + 1}
                    fill="none"
                    stroke={tone}
                    strokeWidth={2.5}
                    opacity={0.85}
                    pointerEvents="none"
                  >
                    <animate
                      attributeName="r"
                      values={`${baseR + 1};${baseR + 12};${baseR + 12}`}
                      keyTimes="0;0.5;1"
                      dur="2.4s"
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      values="0.85;0;0"
                      keyTimes="0;0.5;1"
                      dur="2.4s"
                      repeatCount="indefinite"
                    />
                  </circle>
                );
              })
            : null}
        </Box>

      </Box>

      {/* Floating hover tooltip — portaled to document.body so the
          ancestor `filter: drop-shadow(...)` on the map wrapper can't
          hijack `position: fixed` (CSS filters create a new containing
          block for fixed-positioned descendants, which silently
          re-anchors the popup to the wrapper instead of the viewport
          and pushes it off-screen). */}
      {hover.name && typeof document !== 'undefined'
        ? createPortal(
          <Box
            sx={{
              position: 'fixed',
              left: hover.x + 14,
              top: hover.y + 14,
              zIndex: 2000,
              pointerEvents: 'none',
              px: 1.25,
              py: 0.85,
              borderRadius: 1,
              minWidth: 200,
              bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})`,
              border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
              boxShadow: `0 6px 16px ${alpha(theme.palette.common.black, 0.45)}`,
              backdropFilter: 'blur(4px)'
            }}
          >
            {/* State name — the popup's primary anchor, always rendered
                regardless of whether the row sample has aggregates for
                this state. */}
            <Typography
              sx={{
                color: theme.palette.common.white,
                fontWeight: 700,
                fontSize: '0.9rem',
                letterSpacing: '0.01em',
                lineHeight: 1.2
              }}
            >
              {hover.name}
            </Typography>
            {/* Three-piece info block: regional avg yield, then wheat
                varieties grown there. Structure is always rendered so
                the user sees the same layout for every hovered state;
                missing values fall back to a quiet "—" placeholder
                rather than collapsing the layout. */}
            <Stack spacing={0.5} sx={{ mt: 0.5 }}>
              {hoveredAggregate ? (
                <Typography sx={{ color: alpha(theme.palette.common.white, 0.7), fontSize: '0.72rem', fontWeight: 500 }}>
                  {hoveredAggregate.count.toLocaleString()} field
                  {hoveredAggregate.count === 1 ? '' : 's'} ·{' '}
                  {hoveredAggregate.totalAcres.toLocaleString(undefined, { maximumFractionDigits: 0 })} acres
                </Typography>
              ) : null}
              {/* Regional average yield row */}
              <Box>
                <Typography
                  sx={{
                    color: alpha(theme.palette.common.white, 0.55),
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    lineHeight: 1.3
                  }}
                >
                  Regional avg yield
                </Typography>
                {hoveredAggregate &&
                Number.isFinite(hoveredAggregate.avgYield) &&
                hoveredAggregate.avgYield > 0 ? (
                  <Typography
                    sx={{
                      color: getYieldTone(hoveredAggregate.avgYield, yieldRange, theme),
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      lineHeight: 1.3
                    }}
                  >
                    {hoveredAggregate.avgYield.toFixed(1)}{' '}
                    <Box component="span" sx={{ color: alpha(theme.palette.common.white, 0.65), fontSize: '0.7rem', fontWeight: 500 }}>
                      bu/ac · {getYieldBucketLabel(hoveredAggregate.avgYield, yieldRange)}
                    </Box>
                  </Typography>
                ) : (
                  <Typography sx={{ color: alpha(theme.palette.common.white, 0.4), fontSize: '0.72rem', fontStyle: 'italic' }}>
                    —
                  </Typography>
                )}
              </Box>
              {/* Wheat varieties row — uses distinct variety names from
                  the rows for this state, falling back to crop categories
                  when variety names aren't populated. */}
              <Box sx={{ pt: 0.4, borderTop: `1px solid ${alpha(theme.palette.primary.main, 0.35)}` }}>
                <Typography
                  sx={{
                    color: alpha(theme.palette.common.white, 0.55),
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    lineHeight: 1.3
                  }}
                >
                  Wheat varieties
                </Typography>
                {hoveredAggregate &&
                (hoveredAggregate.varieties.length > 0 || hoveredAggregate.crops.length > 0) ? (
                  <Typography
                    sx={{
                      color: alpha(theme.palette.common.white, 0.88),
                      fontSize: '0.74rem',
                      fontWeight: 500,
                      lineHeight: 1.4,
                      maxWidth: 240
                    }}
                  >
                    {hoveredAggregate.varieties.length > 0
                      ? hoveredAggregate.varieties.join(', ')
                      : formatCropNames(hoveredAggregate.crops).join(', ')}
                  </Typography>
                ) : (
                  <Typography sx={{ color: alpha(theme.palette.common.white, 0.4), fontSize: '0.72rem', fontStyle: 'italic' }}>
                    —
                  </Typography>
                )}
              </Box>
            </Stack>
          </Box>,
          document.body
        )
        : null}

      {/* Legend strip — three colored dots tied to the actual yield buckets
          so the user knows what the pin colors mean. The numeric ranges
          adapt to the page's yield_range (min/max from the API). */}
      <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', justifyContent: 'center', rowGap: 0.5 }}>
        <LegendDot color={theme.palette.warning.light} label={`${bucketLabels.low} bu/ac`} />
        <LegendDot color={theme.palette.primary.light} label={`${bucketLabels.mid} bu/ac`} />
        <LegendDot color={theme.palette.success.light} label={`${bucketLabels.high} bu/ac`} />
        <Typography
          sx={{
            color: alpha(theme.palette.common.white, 0.45),
            fontSize: '0.65rem',
            fontWeight: 500,
            letterSpacing: '0.04em',
            alignSelf: 'center'
          }}
        >
          · {legendStateCount} state{legendStateCount === 1 ? '' : 's'} with data
        </Typography>
      </Stack>
    </Stack>
  );
}

function LegendDot({ color, label }) {
  const theme = useTheme();
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <Box
        component="span"
        sx={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          bgcolor: color,
          boxShadow: `0 0 4px ${alpha(color, 0.6)}`,
          display: 'inline-block'
        }}
      />
      <Typography
        sx={{
          color: alpha(theme.palette.common.white, 0.65),
          fontSize: '0.68rem',
          fontWeight: 500,
          letterSpacing: '0.02em'
        }}
      >
        {label}
      </Typography>
    </Stack>
  );
}
