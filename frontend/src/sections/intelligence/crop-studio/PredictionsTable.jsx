// Per-row prediction table for the chart cards' Table view. Styled
// identically to the original Field & Harvest Records table
// (sections/intelligence/crop-studio/FieldTable) so the two surfaces
// read as one design family — same header tone, same row hover, same
// scrollbar treatment, same pagination chrome.
//
// Consumes `payload.points` from /predict/scatter so it inherits every
// active filter (model / coverage scope / season / state) without a
// second fetch. Default sort is |residual| desc — the worst predictions
// surface first, which is what most users want from a diagnostic table.
// Row-click opens the FieldDetailDrawer (same drawer the scatter-point
// click uses), preserving the drill-in pathway.

import { useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';

import DownloadOutlined from '@ant-design/icons/DownloadOutlined';
import RightOutlined from '@ant-design/icons/RightOutlined';

import { formatCropName } from 'utils/cropName';

// Column definitions for the table. `id` is the sort key, `label` the
// header text — labels carry their units in parens (matches FieldTable's
// "Observed Yield (bu/ac)" header pattern) so the unit is visible at
// the column level AND inline in each cell, eliminating any "what unit
// is this in?" guessing. All cells are center-aligned (matches
// FieldTable's `textAlign: 'center !important'` rule).
const COLUMNS = [
  { id: 'field_number', label: 'Field ID', sortable: true },
  { id: 'crop', label: 'Crop', sortable: false },
  { id: 'variety', label: 'Variety', sortable: false },
  { id: 'season_year', label: 'Season', sortable: true },
  { id: 'location', label: 'Location', sortable: false },
  { id: 'observed', label: 'Observed Yield (bu/ac)', sortable: true },
  { id: 'predicted', label: 'Predicted Yield (bu/ac)', sortable: true },
  {
    id: 'residual',
    label: 'Residual (bu/ac)',
    sortable: true,
    tooltip:
      'Predicted − Observed. Positive = model over-predicted; negative = under-predicted. Sorted by magnitude by default — the worst misses float to the top.'
  },
  // Coverage column removed — the dashboard is pinned to the cleaned
  // training envelope, so every visible row would carry the same tier
  // badge. Drop the column rather than render a wall of identical
  // chips. If the multi-tier view returns, re-add:
  //   { id: 'coverage_tier', label: 'Coverage', sortable: true }
];

// Tier badge metadata — three tiers, each with a distinct hue so a
// user scanning the column sees the mix at a glance. The hues match
// the coverage-scope selector in the card header so the table reads
// as a continuation of that control's color language.
function tierVisual(tier, theme) {
  switch (tier) {
    case 'training_set':
      return {
        label: 'Training set',
        color: theme.palette.primary.light,
        bg: alpha(theme.palette.primary.main, 0.22),
        border: alpha(theme.palette.primary.main, 0.5),
        tooltip: 'This exact field-season was in the model’s training data — predictions on it are in-sample.'
      };
    case 'in_distribution':
      return {
        label: 'Similar to training',
        color: theme.palette.info ? theme.palette.info.light : theme.palette.primary.light,
        bg: alpha(theme.palette.info ? theme.palette.info.main : theme.palette.primary.main, 0.18),
        border: alpha(theme.palette.info ? theme.palette.info.main : theme.palette.primary.main, 0.45),
        tooltip:
          'Not in training, but the row’s inputs (state, county, variety, yield, acres, totalN) fall inside the training distribution — the model is generalizing to similar data.'
      };
    case 'out_of_distribution':
      return {
        label: 'Out of distribution',
        color: theme.palette.warning.light,
        bg: alpha(theme.palette.warning.main, 0.16),
        border: alpha(theme.palette.warning.main, 0.45),
        tooltip:
          'The row’s inputs fall outside the training distribution (yield, geography, or input ranges) — the model has no training basis to predict this well.'
      };
    default:
      return {
        label: '—',
        color: alpha(theme.palette.common.white, 0.55),
        bg: alpha(theme.palette.common.white, 0.08),
        border: alpha(theme.palette.common.white, 0.18),
        tooltip: 'Coverage information not available for this model.'
      };
  }
}

// Pairwise comparator. Nulls always sort last regardless of direction.
function compare(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

// Sort-value accessor, centralized so derived columns (crop_variety,
// location, residual-by-magnitude) stay clean in the sort path.
function getSortValue(point, columnId) {
  switch (columnId) {
    case 'field_number':
      return Number.isFinite(Number(point.field_number)) ? Number(point.field_number) : point.field_number;
    case 'season_year':
      return point.season_year;
    case 'observed':
      return point.observed;
    case 'predicted':
      return point.predicted;
    case 'residual':
      // Sort by absolute residual so largest errors (positive or negative)
      // bubble to the top by default. Flipping to asc shows "best fits".
      return Number.isFinite(point.residual) ? Math.abs(point.residual) : null;
    case 'coverage_tier': {
      // Ordered: training_set < in_distribution < out_of_distribution.
      const order = { training_set: 0, in_distribution: 1, out_of_distribution: 2, unknown: 3 };
      return order[point.coverage_tier] ?? 99;
    }
    default:
      return point[columnId];
  }
}

export default function PredictionsTable({
  points = [],
  rmse,
  theme: themeProp,
  onRowClick,
  emptyMessage = 'No predictions match the active filters.'
}) {
  const theme = themeProp || useTheme();

  // ───────── Sort + pagination state ─────────
  const [orderBy, setOrderBy] = useState('residual');
  const [order, setOrder] = useState('desc');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // Sorted view, memoized so resorts don't re-run when only paging
  // changes. `arr.sort` is in-place, hence the spread.
  const sortedPoints = useMemo(() => {
    if (!Array.isArray(points) || points.length === 0) return [];
    const arr = [...points];
    arr.sort((a, b) => {
      const av = getSortValue(a, orderBy);
      const bv = getSortValue(b, orderBy);
      const cmp = compare(av, bv);
      return order === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [points, orderBy, order]);

  // Coverage column has been removed from the table (dashboard scoped
  // to the cleaned training envelope). hasCoverageData is forced false
  // so the per-row coverage cell never renders and the chevron stays on
  // the residual cell. Restore the useMemo + detection logic if the
  // multi-tier view ever returns.
  const hasCoverageData = false;

  // Column list filtered to drop the coverage column when there's no
  // tier data to display. Defined here so both the header rendering
  // and the per-cell rendering iterate over the same active columns.
  const visibleColumns = useMemo(
    () => COLUMNS.filter((col) => col.id !== 'coverage_tier' || hasCoverageData),
    [hasCoverageData]
  );

  const pageStart = page * rowsPerPage;
  const visibleRows = sortedPoints.slice(pageStart, pageStart + rowsPerPage);

  // ───────── Shared style tokens ─────────
  // Pulled into named constants so the table styling matches FieldTable
  // line-for-line. If FieldTable's tokens shift in the future, the
  // grep target is here.
  const mutedAccent = alpha(theme.palette.primary.light, 0.85);
  const subtleText = theme.palette.text.secondary;
  // Themed tooltip slotProps — same primary-tinted opaque surface every
  // hover-help affordance in the app uses (PredictionInputStep's
  // asterisks, ModelRegressionCard's coverage tooltip, the Saved
  // Predictions Inputs chip). Centralized here so the column header
  // tooltip and the per-row Coverage tier tooltip share one source of
  // truth — fix the surface here, both surfaces update.
  const themedTooltipSlotProps = {
    tooltip: {
      sx: {
        bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 22%, ${theme.palette.background.paper})`,
        color: theme.palette.common.white,
        border: `1px solid ${alpha(theme.palette.primary.main, 0.55)}`,
        fontSize: '0.74rem',
        fontWeight: 500,
        lineHeight: 1.55,
        maxWidth: 340,
        px: 1.5,
        py: 1.1,
        borderRadius: 1.25,
        boxShadow: `0 6px 18px ${alpha(theme.palette.common.black, 0.4)}`
      }
    },
    arrow: {
      sx: { color: `color-mix(in srgb, ${theme.palette.primary.main} 22%, ${theme.palette.background.paper})` }
    }
  };
  const tableScrollbarSx = {
    scrollbarWidth: 'thin',
    scrollbarColor: `${alpha(theme.palette.primary.main, 0.32)} transparent`,
    '&::-webkit-scrollbar': { width: 10, height: 10 },
    '&::-webkit-scrollbar-track': {
      background: alpha(theme.palette.primary.main, 0.06),
      borderRadius: 8
    },
    '&::-webkit-scrollbar-thumb': {
      background: alpha(theme.palette.primary.main, 0.28),
      borderRadius: 8,
      border: '2px solid transparent',
      backgroundClip: 'padding-box'
    },
    '&::-webkit-scrollbar-thumb:hover': {
      background: alpha(theme.palette.primary.main, 0.5),
      backgroundClip: 'padding-box'
    }
  };

  // Empty state — same muted treatment FieldTable uses when no rows match.
  if (!points.length) {
    return (
      <Typography
        sx={{
          color: alpha(theme.palette.common.white, 0.6),
          fontSize: '0.85rem',
          p: 4,
          textAlign: 'center'
        }}
      >
        {emptyMessage}
      </Typography>
    );
  }

  const handleRequestSort = (columnId) => {
    if (orderBy === columnId) {
      setOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrderBy(columnId);
      // Numeric / value columns start desc (largest first), text columns
      // start asc (alphabetical) — what users expect from each data type.
      const numericColumns = new Set([
        'field_number',
        'season_year',
        'observed',
        'predicted',
        'residual',
        'coverage_tier'
      ]);
      setOrder(numericColumns.has(columnId) ? 'desc' : 'asc');
    }
    setPage(0);
  };

  return (
    <>
    {/* Bordered surface matches the FieldTable wrapper used in the
        Overview tab — primary-tinted bg, primary-alpha border, rounded
        corners. Gives the table a clear visual identity (same family as
        every other "data card" surface in the app) instead of floating
        edge-to-edge inside the chart card. `overflow: hidden` keeps
        sticky-header borders from peeking past the rounded corners. */}
    <Box
      sx={{
        bgcolor: alpha(theme.palette.primary.main, 0.18),
        border: `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
        borderRadius: 2,
        overflow: 'hidden',
        backgroundImage: 'none',
        boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.35)}`
      }}
    >
      <TableContainer
        sx={{
          maxHeight: { xs: 420, md: 500 },
          ...tableScrollbarSx
        }}
      >
        <Table
          size="small"
          stickyHeader
          sx={{
            minWidth: 1100,
            '& .MuiTableCell-root': { textAlign: 'center !important', whiteSpace: 'nowrap' }
          }}
        >
          <TableHead>
            <TableRow
              sx={{
                '& .MuiTableCell-root': {
                  // Opaque equivalent of alpha(primary.main, 0.08) so rows
                  // can't bleed through the sticky header during scroll.
                  bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 8%, ${theme.palette.background.paper})`,
                  borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.22)}`,
                  color: alpha(theme.palette.primary.light, 0.85),
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                  py: 1.25,
                  textAlign: 'center'
                },
                // Force the TableSortLabel to fill the cell and center its
                // content so the label sits visually centered. Without
                // this, MUI's inline-flex TableSortLabel renders only as
                // wide as label + (reserved) icon space, which pushes
                // the visible label off-center.
                '& .MuiTableSortLabel-root': {
                  color: `${alpha(theme.palette.primary.light, 0.85)} !important`,
                  width: '100%',
                  justifyContent: 'center'
                },
                '& .MuiTableSortLabel-root:hover, & .MuiTableSortLabel-root.Mui-active': {
                  color: `${theme.palette.primary.light} !important`
                },
                // Collapse the sort icon's footprint when the column isn't
                // active so the label stays centered. Restored to natural
                // width when active so the asc/desc arrow can show.
                '& .MuiTableSortLabel-root:not(.Mui-active) .MuiTableSortLabel-icon': {
                  width: 0,
                  marginLeft: 0,
                  marginRight: 0,
                  opacity: 0
                },
                '& .MuiTableSortLabel-icon': {
                  color: `${alpha(theme.palette.primary.light, 0.85)} !important`
                }
              }}
            >
              {visibleColumns.map((column) => (
                <TableCell key={column.id} sortDirection={orderBy === column.id ? order : false}>
                  {column.sortable ? (
                    <Tooltip
                      arrow
                      placement="top"
                      title={column.tooltip || ''}
                      disableHoverListener={!column.tooltip}
                      slotProps={themedTooltipSlotProps}
                    >
                      <TableSortLabel
                        active={orderBy === column.id}
                        direction={orderBy === column.id ? order : 'asc'}
                        onClick={() => handleRequestSort(column.id)}
                      >
                        {column.label}
                      </TableSortLabel>
                    </Tooltip>
                  ) : (
                    column.label
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>

          <TableBody>
            {visibleRows.map((point) => {
              const tier = tierVisual(point.coverage_tier, theme);
              const cropLabel = point.crop ? formatCropName(point.crop) : '—';
              const variety = point.variety || '—';
              const location = [point.county, point.state].filter(Boolean).join(', ') || '—';
              const isClickable = Boolean(onRowClick && point.field_season_id != null);
              const hasObserved = Number.isFinite(point.observed);
              const hasPredicted = Number.isFinite(point.predicted);
              const hasResidual = Number.isFinite(point.residual);
              return (
                <TableRow
                  key={point.field_season_id}
                  hover
                  onClick={isClickable ? () => onRowClick(point) : undefined}
                  sx={{
                    cursor: isClickable ? 'pointer' : 'default',
                    transition: 'background 0.15s ease',
                    '& .MuiTableCell-root': {
                      borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.08)}`
                    },
                    // Chevron animation — faint at rest, brightens and
                    // nudges right on row hover. Same pattern as
                    // FieldTable's '& .row-chevron' selector so the
                    // affordance feels identical across the app.
                    '& .row-chevron': {
                      color: alpha(theme.palette.primary.light, 0.45),
                      transition: 'color 0.15s ease, transform 0.15s ease, opacity 0.15s ease',
                      opacity: 0.7
                    },
                    // Hover treatment matches FieldTable exactly — a small
                    // saturation bump on the row + a 3px inset bar on the
                    // left edge that signals "this row is the active one".
                    '&:hover': {
                      bgcolor: alpha(theme.palette.primary.main, 0.16),
                      boxShadow: `inset 3px 0 0 ${theme.palette.primary.main}`
                    },
                    '&:hover .row-chevron': {
                      color: theme.palette.primary.light,
                      transform: 'translateY(-50%) translateX(2px)',
                      opacity: 1
                    }
                  }}
                >
                  <TableCell sx={{ color: mutedAccent, fontWeight: 600 }}>
                    {point.field_number ?? '—'}
                  </TableCell>
                  <TableCell>{cropLabel}</TableCell>
                  <TableCell>{variety}</TableCell>
                  <TableCell sx={{ color: mutedAccent }}>{point.season_year ?? '—'}</TableCell>
                  <TableCell sx={{ color: mutedAccent }}>{location}</TableCell>
                  <TableCell>
                    {hasObserved ? (
                      <Stack
                        component="span"
                        direction="row"
                        spacing={0.75}
                        sx={{ alignItems: 'baseline', justifyContent: 'center' }}
                      >
                        <Typography
                          component="span"
                          sx={{ color: theme.palette.success.main, fontWeight: 700, fontSize: '0.9rem' }}
                        >
                          {point.observed.toFixed(1)}
                        </Typography>
                        <Typography component="span" sx={{ color: subtleText, fontSize: '0.72rem' }}>
                          bu/ac
                        </Typography>
                      </Stack>
                    ) : (
                      <Typography component="span" sx={{ color: subtleText }}>
                        —
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {hasPredicted ? (
                      <Stack
                        component="span"
                        direction="row"
                        spacing={0.75}
                        sx={{ alignItems: 'baseline', justifyContent: 'center' }}
                      >
                        <Typography
                          component="span"
                          sx={{ color: alpha(theme.palette.primary.light, 0.95), fontWeight: 700, fontSize: '0.9rem' }}
                        >
                          {point.predicted.toFixed(1)}
                        </Typography>
                        <Typography component="span" sx={{ color: subtleText, fontSize: '0.72rem' }}>
                          bu/ac
                        </Typography>
                      </Stack>
                    ) : (
                      <Typography component="span" sx={{ color: subtleText }}>
                        —
                      </Typography>
                    )}
                  </TableCell>
                  {/* Residual cell — last cell when Coverage column is
                      hidden, so it carries the chevron in that case.
                      Otherwise just renders the value. position: relative
                      lets the chevron's absolute positioning anchor to
                      the cell. */}
                  <TableCell sx={!hasCoverageData ? { position: 'relative' } : undefined}>
                    {hasResidual ? (
                      <Stack
                        component="span"
                        direction="row"
                        spacing={0.75}
                        sx={{ alignItems: 'baseline', justifyContent: 'center' }}
                      >
                        <Typography
                          component="span"
                          sx={{
                            // Color the residual by direction: positive
                            // (over-predicted) reads as warning amber,
                            // negative (under-predicted) reads as info
                            // blue. Magnitude is communicated by
                            // saturating the alpha against a soft RMSE
                            // anchor so most rows sit pale and the worst
                            // outliers pop.
                            color:
                              point.residual >= 0
                                ? alpha(
                                    theme.palette.warning.light,
                                    Math.min(0.55 + Math.abs(point.residual) / Math.max(2 * (rmse || 1), 1), 1)
                                  )
                                : alpha(
                                    theme.palette.info ? theme.palette.info.light : theme.palette.primary.light,
                                    Math.min(0.55 + Math.abs(point.residual) / Math.max(2 * (rmse || 1), 1), 1)
                                  ),
                            fontWeight: 700,
                            fontSize: '0.9rem'
                          }}
                        >
                          {`${point.residual >= 0 ? '+' : ''}${point.residual.toFixed(1)}`}
                        </Typography>
                        <Typography component="span" sx={{ color: subtleText, fontSize: '0.72rem' }}>
                          bu/ac
                        </Typography>
                      </Stack>
                    ) : (
                      <Typography component="span" sx={{ color: subtleText }}>
                        —
                      </Typography>
                    )}
                    {/* Chevron floats over the cell's right edge when
                        Residual is the last column. No effect on header
                        alignment because headers are centered via the
                        TableSortLabel width: 100% rule. */}
                    {!hasCoverageData && isClickable ? (
                      <Box
                        className="row-chevron"
                        aria-hidden
                        sx={{
                          position: 'absolute',
                          right: 8,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.7rem',
                          pointerEvents: 'none'
                        }}
                      >
                        <RightOutlined />
                      </Box>
                    ) : null}
                  </TableCell>
                  {/* Coverage column conditionally rendered. When the
                      whole payload lacks tier data (hasCoverageData ===
                      false), the column is hidden entirely so the row
                      doesn't carry a dead cell that'd misalign the
                      header. When present, this is the LAST cell — so
                      the chevron lives here. */}
                  {hasCoverageData ? (
                    <TableCell sx={{ position: 'relative' }}>
                      <Tooltip arrow placement="top" title={tier.tooltip} slotProps={themedTooltipSlotProps}>
                        <Box
                          component="span"
                          sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            px: 1,
                            py: 0.3,
                            borderRadius: 999,
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            letterSpacing: '0.02em',
                            color: tier.color,
                            bgcolor: tier.bg,
                            border: `1px solid ${tier.border}`,
                            whiteSpace: 'nowrap',
                            cursor: 'help'
                          }}
                        >
                          {tier.label}
                        </Box>
                      </Tooltip>
                      {isClickable ? (
                        <Box
                          className="row-chevron"
                          aria-hidden
                          sx={{
                            position: 'absolute',
                            right: 8,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.7rem',
                            pointerEvents: 'none'
                          }}
                        >
                          <RightOutlined />
                        </Box>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Footer summary inside the bordered card — "X shown on page Y · Z total"
          on the left, Download CSV button on the right. Mirrors FieldTable's
          footer Stack so the two tables share the same closing chrome. */}
      <Stack
        direction="row"
        sx={{
          px: 2.5,
          py: 1.75,
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: `1px solid ${alpha(theme.palette.primary.main, 0.18)}`,
          flexWrap: 'wrap',
          gap: 1.25
        }}
      >
        <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
          {`${visibleRows.length.toLocaleString()} shown on page ${page + 1} · ${sortedPoints.length.toLocaleString()} total`}
        </Typography>
        <Button
          variant="outlined"
          size="small"
          startIcon={<DownloadOutlined />}
          onClick={() => downloadPointsAsCsv(sortedPoints, visibleColumns)}
          sx={{
            textTransform: 'none',
            fontWeight: 600,
            fontSize: '0.78rem',
            color: alpha(theme.palette.primary.light, 0.95),
            borderColor: alpha(theme.palette.primary.main, 0.5),
            '&:hover': {
              borderColor: theme.palette.primary.main,
              bgcolor: alpha(theme.palette.primary.main, 0.16),
              color: theme.palette.common.white
            }
          }}
        >
          Download CSV
        </Button>
      </Stack>
    </Box>
    {/* Pagination sits OUTSIDE the bordered card to match the
        Overview tab's FieldTable layout. The -0.75 top margin pulls
        it close to the card visually while keeping the boundary clear. */}
    <TablePagination
      component="div"
      count={sortedPoints.length}
      page={page}
      onPageChange={(_, newPage) => setPage(newPage)}
      rowsPerPage={rowsPerPage}
      onRowsPerPageChange={(event) => {
        setRowsPerPage(parseInt(event.target.value, 10));
        setPage(0);
      }}
      rowsPerPageOptions={[25, 50, 100, 250, 500]}
      sx={{ mt: -0.75 }}
    />
    </>
  );
}

// Client-side CSV download for the currently-sorted, currently-filtered
// rows. PredictionsTable's data is already in memory (from the chart
// card's /predict/scatter fetch), so no extra round-trip is needed.
// Quotes any field containing a comma/quote/newline and escapes quotes
// per RFC 4180. Triggered by the Download CSV button in the footer.
function downloadPointsAsCsv(rows, columns) {
  if (!Array.isArray(rows) || rows.length === 0) return;

  const escape = (value) => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // Header row mirrors the visible columns so the download matches what
  // the user sees in the UI. Strip the unit suffix from labels so the
  // CSV header reads as a clean column name (units are still implied by
  // the column meaning).
  const header = columns.map((c) => escape(c.label));

  // Body rows — same accessor logic per column. Pulls raw values where
  // useful (residual stays signed, no "+" prefix to keep it numeric).
  const body = rows.map((p) =>
    columns
      .map((col) => {
        switch (col.id) {
          case 'field_number':
            return escape(p.field_number);
          case 'crop':
            return escape(p.crop || '');
          case 'variety':
            return escape(p.variety || '');
          case 'season_year':
            return escape(p.season_year);
          case 'location':
            return escape([p.county, p.state].filter(Boolean).join(', '));
          case 'observed':
            return escape(Number.isFinite(p.observed) ? p.observed.toFixed(2) : '');
          case 'predicted':
            return escape(Number.isFinite(p.predicted) ? p.predicted.toFixed(2) : '');
          case 'residual':
            return escape(Number.isFinite(p.residual) ? p.residual.toFixed(2) : '');
          case 'coverage_tier':
            return escape(p.coverage_tier || '');
          default:
            return escape(p[col.id]);
        }
      })
      .join(',')
  );

  const csv = [header.join(','), ...body].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `predictions-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
