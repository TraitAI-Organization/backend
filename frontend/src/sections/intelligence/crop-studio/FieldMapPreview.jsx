import { useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';

import { US_STATES, US_VIEWBOX } from 'sections/intelligence/crop-studio/usStatesPaths';

// Roll up the field rows into per-state aggregates: count, total acres, and
// average OBSERVED yield. Avg yield is what drives pin color so the user is
// looking at real outcomes, not predictions.
function aggregateByState(fields) {
  const byState = new Map();
  for (const field of fields) {
    if (!field?.state) continue;
    if (!byState.has(field.state)) {
      byState.set(field.state, { state: field.state, count: 0, totalAcres: 0, observedYields: [] });
    }
    const entry = byState.get(field.state);
    entry.count += 1;
    const acres = Number(field.acres);
    if (Number.isFinite(acres)) entry.totalAcres += acres;
    const observed = Number(field.yield_bu_ac);
    if (Number.isFinite(observed)) entry.observedYields.push(observed);
  }
  const out = {};
  for (const [name, e] of byState) {
    out[name] = {
      ...e,
      avgYield:
        e.observedYields.length > 0
          ? e.observedYields.reduce((a, b) => a + b, 0) / e.observedYields.length
          : null
    };
  }
  return out;
}

// Map an observed-yield value to a tone bucket, using the page's actual
// yield_range (min/max from the overview API) as the bucket boundaries —
// the legend below the map (and the Observed Yield Range section on the
// page) will agree with the colors. Splits the range into thirds.
function getYieldTone(observedYield, yieldRange, theme) {
  if (!Number.isFinite(observedYield)) return theme.palette.primary.light;
  const min = Number(yieldRange?.min);
  const max = Number(yieldRange?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return theme.palette.primary.light;
  }
  const lowCut = min + (max - min) / 3;
  const highCut = min + (2 * (max - min)) / 3;
  if (observedYield < lowCut) return theme.palette.warning.light;
  if (observedYield < highCut) return theme.palette.primary.light;
  return theme.palette.success.light;
}

// Same thirds-of-range rule but returning the bucket label, used in the
// hover tooltip ("Yield: 67.4 bu/ac · Mid range").
function getYieldBucketLabel(observedYield, yieldRange) {
  if (!Number.isFinite(observedYield)) return 'No yield data';
  const min = Number(yieldRange?.min);
  const max = Number(yieldRange?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 'Mid range';
  const lowCut = min + (max - min) / 3;
  const highCut = min + (2 * (max - min)) / 3;
  if (observedYield < lowCut) return 'Low range';
  if (observedYield < highCut) return 'Mid range';
  return 'High range';
}

export default function FieldMapPreview({ fields = [], yieldRange = { min: 0, max: 0, avg: 0 } }) {
  const theme = useTheme();
  const stateAggregates = useMemo(() => aggregateByState(fields), [fields]);
  // Hover state — a tiny FSM driving the floating tooltip overlay. We track
  // the state name and the cursor's clientX/Y so the tooltip can follow the
  // pointer instead of pinning to a fixed offset (which would feel detached
  // from the state path under it).
  const [hover, setHover] = useState({ name: null, x: 0, y: 0 });

  // Yield-range bucket boundaries for the legend strip — computed once so we
  // can show the user exactly what each pin color corresponds to in bu/ac.
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
          <defs>
            {/* Soft glow for the pin halos so the markers feel "lit" rather
                than sitting flat on the map. */}
            <filter id="pinHalo" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" />
            </filter>
          </defs>

          {/* State silhouettes — every state gets a path. States with data in
              the DB are tinted slightly stronger so the populated regions
              read at a glance, while empty states fade into the background.
              Hovering any state pops the floating tooltip with state info. */}
          {US_STATES.map((state) => {
            const data = stateAggregates[state.name];
            const hasData = Boolean(data);
            const isHovered = hover.name === state.name;
            const fillBase = hasData
              ? alpha(theme.palette.primary.main, 0.22)
              : alpha(theme.palette.primary.main, 0.06);
            const fill = isHovered
              ? alpha(theme.palette.primary.main, hasData ? 0.36 : 0.14)
              : fillBase;
            const stroke = hasData
              ? alpha(theme.palette.primary.light, 0.7)
              : alpha(theme.palette.primary.light, 0.28);
            return (
              <path
                key={state.abbr}
                d={state.d}
                fill={fill}
                stroke={stroke}
                strokeWidth={isHovered ? 1.4 : 0.8}
                strokeLinejoin="round"
                style={{ cursor: hasData ? 'pointer' : 'default', transition: 'fill 0.15s ease, stroke-width 0.15s ease' }}
                onMouseEnter={(e) => handlePointerMove(e, state.name)}
                onMouseMove={(e) => handlePointerMove(e, state.name)}
                onMouseLeave={handlePointerLeave}
              />
            );
          })}

          {/* Pin markers — only on states that have data. Halo + solid pin
              + inner highlight gives each pin a small amount of depth so it
              doesn't look like a flat sticker. Color encodes the state's
              average observed yield via the same thirds-of-range bucketing
              the legend explains. */}
          {US_STATES.map((state) => {
            const data = stateAggregates[state.name];
            if (!data) return null;
            const tone = getYieldTone(data.avgYield, yieldRange, theme);
            const [cx, cy] = state.centroid;
            const isHovered = hover.name === state.name;
            const r = isHovered ? 7 : 5.5;
            return (
              <g
                key={`pin-${state.abbr}`}
                transform={`translate(${cx},${cy})`}
                style={{ cursor: 'pointer', transition: 'transform 0.15s ease' }}
                onMouseEnter={(e) => handlePointerMove(e, state.name)}
                onMouseMove={(e) => handlePointerMove(e, state.name)}
                onMouseLeave={handlePointerLeave}
              >
                {/* Halo */}
                <circle r={r * 2.2} fill={alpha(tone, 0.22)} filter="url(#pinHalo)" />
                {/* Solid pin */}
                <circle
                  r={r}
                  fill={tone}
                  stroke={alpha(theme.palette.common.white, 0.9)}
                  strokeWidth="1"
                />
                {/* Inner highlight — gives the pin a tiny "lit-from-above"
                    feel without needing a real gradient definition. */}
                <circle cx="-1" cy="-1.4" r={r * 0.35} fill={alpha(theme.palette.common.white, 0.55)} />
              </g>
            );
          })}
        </Box>

        {/* Floating hover tooltip — anchored to the pointer and positioned
            via fixed coords so it never gets clipped by the SVG. Renders
            outside the SVG so we can use full MUI Typography styling. */}
        {hover.name ? (
          <Box
            sx={{
              position: 'fixed',
              left: hover.x + 14,
              top: hover.y + 14,
              zIndex: 1500,
              pointerEvents: 'none',
              px: 1.25,
              py: 0.85,
              borderRadius: 1,
              minWidth: 160,
              bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 18%, ${theme.palette.background.paper})`,
              border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
              boxShadow: `0 6px 16px ${alpha(theme.palette.common.black, 0.45)}`,
              backdropFilter: 'blur(4px)'
            }}
          >
            <Typography
              sx={{
                color: theme.palette.common.white,
                fontWeight: 700,
                fontSize: '0.82rem',
                letterSpacing: '0.01em',
                lineHeight: 1.2
              }}
            >
              {hover.name}
            </Typography>
            {hoveredAggregate ? (
              <Stack spacing={0.15} sx={{ mt: 0.4 }}>
                <Typography sx={{ color: alpha(theme.palette.common.white, 0.75), fontSize: '0.72rem', fontWeight: 500 }}>
                  {hoveredAggregate.count.toLocaleString()} field
                  {hoveredAggregate.count === 1 ? '' : 's'} ·{' '}
                  {hoveredAggregate.totalAcres.toLocaleString(undefined, { maximumFractionDigits: 0 })} acres
                </Typography>
                {Number.isFinite(hoveredAggregate.avgYield) ? (
                  <Typography sx={{ color: alpha(theme.palette.common.white, 0.85), fontSize: '0.72rem', fontWeight: 600 }}>
                    Avg observed yield:{' '}
                    <Box
                      component="span"
                      sx={{ color: getYieldTone(hoveredAggregate.avgYield, yieldRange, theme), fontWeight: 700 }}
                    >
                      {hoveredAggregate.avgYield.toFixed(1)} bu/ac
                    </Box>{' '}
                    · {getYieldBucketLabel(hoveredAggregate.avgYield, yieldRange)}
                  </Typography>
                ) : (
                  <Typography sx={{ color: alpha(theme.palette.common.white, 0.55), fontSize: '0.7rem', fontStyle: 'italic' }}>
                    No observed-yield data
                  </Typography>
                )}
              </Stack>
            ) : (
              <Typography
                sx={{ color: alpha(theme.palette.common.white, 0.55), fontSize: '0.7rem', fontStyle: 'italic' }}
              >
                No fields tracked
              </Typography>
            )}
          </Box>
        ) : null}
      </Box>

      {/* Legend strip — three colored dots tied to the actual observed-yield
          buckets so the user knows what the pin colors mean. The numeric
          ranges adapt to the page's yield_range (min/max from the API). */}
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
          · {Object.keys(stateAggregates).length} state{Object.keys(stateAggregates).length === 1 ? '' : 's'} with data
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
