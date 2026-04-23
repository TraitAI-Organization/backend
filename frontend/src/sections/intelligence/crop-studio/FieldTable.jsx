import { useEffect, useMemo, useState } from 'react';

import DownloadOutlined from '@ant-design/icons/DownloadOutlined';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import TablePagination from '@mui/material/TablePagination';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';

import MainCard from 'components/MainCard';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');
const DOWNLOAD_PAGE_SIZE = 500;
const initialServerFilters = {
  crop: '',
  variety: '',
  season: '',
  state: '',
  county: ''
};

const columns = [
  { id: 'fieldId', label: 'Field ID' },
  { id: 'crop', label: 'Crop' },
  { id: 'acres', label: 'acres' },
  { id: 'variety', label: 'Variety' },
  { id: 'season', label: 'Season' },
  { id: 'location', label: 'Location' },
  { id: 'observedYield', label: 'Observed Yield (bu/ac)' },
  // { id: 'predictedYield', label: 'Predicted Yield (bu/ac)' },
  { id: 'n', label: 'N (lb/ac)' },
  { id: 'p', label: 'P (lb/ac)' },
  { id: 'k', label: 'K (lb/ac)' }
];

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toLocation(county, state) {
  const normalizedCounty = county?.trim();
  const normalizedState = state?.trim();
  if (normalizedCounty && normalizedState) return `${normalizedCounty}, ${normalizedState}`;
  return normalizedCounty || normalizedState || 'N/A';
}

function compareValues(left, right) {
  const leftIsNull = left === null || left === undefined;
  const rightIsNull = right === null || right === undefined;

  if (leftIsNull && rightIsNull) return 0;
  if (leftIsNull) return 1;
  if (rightIsNull) return -1;

  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
}

function getComparator(order, orderBy) {
  if (order === 'desc') {
    return (a, b) => compareValues(b[orderBy], a[orderBy]);
  }
  return (a, b) => compareValues(a[orderBy], b[orderBy]);
}

async function fetchFieldRows(signal, page, limit, filters = initialServerFilters) {
  const params = new URLSearchParams({
    page: String(page + 1),
    limit: String(limit)
  });
  if (filters.crop) params.set('crop', filters.crop);
  if (filters.variety) params.set('variety', filters.variety);
  if (filters.season) params.append('season', String(filters.season));
  if (filters.state) params.set('state', filters.state);
  if (filters.county) params.set('county', filters.county);
  const response = await fetch(`${API_BASE_URL}/fields?${params.toString()}`, { signal });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to load field records (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];

  return {
    rows: rows.map((row) => ({
      rowId: row.field_season_id ?? `${row.field_number ?? 'unknown'}-${row.season ?? 'unknown'}`,
      fieldId: row.field_number ?? row.field_season_id ?? 'N/A',
      crop: row.crop || 'N/A',
      acres: toNumberOrNull(row.acres),
      variety: row.variety || 'N/A',
      season: row.season ?? 'N/A',
      location: toLocation(row.county, row.state),
      observedYield: toNumberOrNull(row.yield_bu_ac),
      n: toNumberOrNull(row.totalN_per_ac),
      p: toNumberOrNull(row.totalP_per_ac),
      k: toNumberOrNull(row.totalK_per_ac)
    })),
    total: Number(payload?.total) || 0
  };
}

function formatMetric(value, decimals = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toFixed(decimals);
}

export default function FieldTable() {
  const theme = useTheme();
  const accentBlue = alpha(theme.palette.primary.main, 0.45);
  const headerBlue = `color-mix(in srgb, ${theme.palette.primary.main} 45%, ${theme.palette.background.paper})`;
  const rowSurface = alpha(theme.palette.grey[500], 0.12);
  const tableScrollbarSx = {
    scrollbarWidth: 'thin',
    scrollbarColor: `${alpha(theme.palette.primary.main, 0.65)} ${alpha(theme.palette.background.default, 0.8)}`,
    '&::-webkit-scrollbar': {
      width: 10,
      height: 10
    },
    '&::-webkit-scrollbar-track': {
      background: alpha(theme.palette.background.default, 0.85),
      borderRadius: 8
    },
    '&::-webkit-scrollbar-thumb': {
      background: alpha(theme.palette.primary.main, 0.65),
      borderRadius: 8,
      border: `2px solid ${alpha(theme.palette.background.default, 0.85)}`
    },
    '&::-webkit-scrollbar-thumb:hover': {
      background: alpha(theme.palette.primary.main, 0.85)
    }
  };
  const [rows, setRows] = useState([]);
  const [order, setOrder] = useState('asc');
  const [orderBy, setOrderBy] = useState('fieldId');
  const [filters, setFilters] = useState(initialServerFilters);
  const [cropOptions, setCropOptions] = useState([]);
  const [varietyOptions, setVarietyOptions] = useState([]);
  const [seasonOptions, setSeasonOptions] = useState([]);
  const [stateOptions, setStateOptions] = useState([]);
  const [countyOptions, setCountyOptions] = useState([]);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [totalRows, setTotalRows] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isFilterOptionsLoading, setIsFilterOptionsLoading] = useState(true);
  const [isVarietyLoading, setIsVarietyLoading] = useState(false);
  const [isCountyLoading, setIsCountyLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    const loadFilterOptions = async () => {
      setIsFilterOptionsLoading(true);
      try {
        const [cropsResponse, seasonsResponse, statesResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/fields/crops/`, { signal: controller.signal }),
          fetch(`${API_BASE_URL}/fields/seasons/`, { signal: controller.signal }),
          fetch(`${API_BASE_URL}/fields/states/`, { signal: controller.signal })
        ]);

        if (!cropsResponse.ok || !seasonsResponse.ok || !statesResponse.ok) {
          throw new Error('Failed to load table filter options.');
        }

        const [cropsPayload, seasonsPayload, statesPayload] = await Promise.all([
          cropsResponse.json(),
          seasonsResponse.json(),
          statesResponse.json()
        ]);

        const crops = Array.from(
          new Set((Array.isArray(cropsPayload) ? cropsPayload : []).map((item) => item?.crop_name_en).filter(Boolean))
        ).sort((a, b) => a.localeCompare(b));
        const seasons = Array.from(
          new Set((Array.isArray(seasonsPayload) ? seasonsPayload : []).map((item) => item?.season_year).filter((value) => value !== null))
        ).sort((a, b) => Number(b) - Number(a));
        const states = Array.from(
          new Set((Array.isArray(statesPayload) ? statesPayload : []).map((item) => item?.state).filter(Boolean))
        ).sort((a, b) => a.localeCompare(b));

        setCropOptions(crops);
        setSeasonOptions(seasons);
        setStateOptions(states);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setLoadError(error.message || 'Failed to load table filter options.');
          setCropOptions([]);
          setSeasonOptions([]);
          setStateOptions([]);
        }
      } finally {
        setIsFilterOptionsLoading(false);
      }
    };

    loadFilterOptions();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const loadVarieties = async () => {
      if (!filters.crop) {
        setVarietyOptions([]);
        return;
      }

      setIsVarietyLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/fields/varieties/?crop=${encodeURIComponent(filters.crop)}`, {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error('Failed to load variety options.');
        }

        const payload = await response.json();
        const varieties = Array.from(
          new Set((Array.isArray(payload) ? payload : []).map((item) => item?.variety_name_en).filter(Boolean))
        ).sort((a, b) => a.localeCompare(b));
        setVarietyOptions(varieties);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setLoadError(error.message || 'Failed to load variety options.');
          setVarietyOptions([]);
        }
      } finally {
        setIsVarietyLoading(false);
      }
    };

    loadVarieties();

    return () => controller.abort();
  }, [filters.crop]);

  useEffect(() => {
    const controller = new AbortController();

    const loadCounties = async () => {
      if (!filters.state) {
        setCountyOptions([]);
        return;
      }

      setIsCountyLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/fields/counties/?state=${encodeURIComponent(filters.state)}`, {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error('Failed to load county options.');
        }

        const payload = await response.json();
        const counties = Array.from(
          new Set((Array.isArray(payload) ? payload : []).map((item) => item?.county).filter(Boolean))
        ).sort((a, b) => a.localeCompare(b));
        setCountyOptions(counties);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setLoadError(error.message || 'Failed to load county options.');
          setCountyOptions([]);
        }
      } finally {
        setIsCountyLoading(false);
      }
    };

    loadCounties();

    return () => controller.abort();
  }, [filters.state]);

  useEffect(() => {
    const controller = new AbortController();

    const loadRows = async () => {
      setIsLoading(true);
      setLoadError('');
      try {
        const result = await fetchFieldRows(controller.signal, page, rowsPerPage, filters);
        setRows(result.rows);
        setTotalRows(result.total);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setLoadError(error.message || 'Failed to load field records.');
          setRows([]);
          setTotalRows(0);
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadRows();

    return () => {
      controller.abort();
    };
  }, [page, rowsPerPage, filters]);

  const sortedRows = useMemo(() => [...rows].sort(getComparator(order, orderBy)), [rows, order, orderBy]);

  const handleRequestSort = (columnId) => {
    const isAsc = orderBy === columnId && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(columnId);
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const allRows = [];
      let currentPage = 0;
      let total = 0;

      do {
        const result = await fetchFieldRows(undefined, currentPage, DOWNLOAD_PAGE_SIZE, filters);
        if (currentPage === 0) total = result.total;
        allRows.push(...result.rows);
        currentPage += 1;
        if (result.rows.length === 0) break;
      } while (allRows.length < total);

      const exportRows = allRows.sort(getComparator(order, orderBy));

      const header = columns.map((column) => column.label).join(',');
      const body = exportRows
      .map((row) =>
        columns
          .map((column) => {
            const rawValue = row[column.id];
            const cell = rawValue === null || rawValue === undefined ? '' : String(rawValue);
            return `"${cell.replace(/"/g, '""')}"`;
          })
          .join(',')
      )
      .join('\n');

      const csv = `${header}\n${body}`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'field-season-records.csv';
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      setLoadError(error.message || 'Failed to download field records.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleChangePage = (_, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleFilterChange = (name, value) => {
    setFilters((prev) => {
      const next = { ...prev, [name]: value };
      if (name === 'crop') next.variety = '';
      if (name === 'state') next.county = '';
      return next;
    });
    setPage(0);
  };

  const clearAllFilters = () => {
    setFilters(initialServerFilters);
    setPage(0);
  };

  const visibleRows = sortedRows;
  const hasActiveFilters = Boolean(filters.crop || filters.variety || filters.season || filters.state || filters.county);
  const downloadLabel = hasActiveFilters ? 'Download Filtered CSV' : 'Download CSV';

  return (
    <MainCard title="Field Records">
      <Stack spacing={2}>
        <Typography variant="body1" color="text.primary">
          Use server-backed filters (crop, variety, season, state, county) to narrow records faster.
        </Typography>
        {loadError ? (
          <Typography variant="body2" color="error.main">
            {loadError}
          </Typography>
        ) : null}

        <Stack direction="row" sx={{ width: '100%', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            select
            size="small"
            value={filters.crop}
            onChange={(event) => handleFilterChange('crop', event.target.value)}
            disabled={isFilterOptionsLoading}
            sx={{ minWidth: { xs: '100%', sm: 180 }, flex: '1 1 180px' }}
            SelectProps={{
              displayEmpty: true,
              renderValue: (selected) => selected || 'All crops'
            }}
          >
            <MenuItem value="">All crops</MenuItem>
            {cropOptions.map((crop) => (
              <MenuItem key={crop} value={crop}>
                {crop}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            value={filters.variety}
            onChange={(event) => handleFilterChange('variety', event.target.value)}
            disabled={!filters.crop || isVarietyLoading}
            sx={{ minWidth: { xs: '100%', sm: 180 }, flex: '1 1 180px' }}
            SelectProps={{
              displayEmpty: true,
              renderValue: (selected) => selected || 'All varieties'
            }}
          >
            <MenuItem value="">All varieties</MenuItem>
            {varietyOptions.map((variety) => (
              <MenuItem key={variety} value={variety}>
                {variety}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            value={filters.season}
            onChange={(event) => handleFilterChange('season', event.target.value)}
            disabled={isFilterOptionsLoading}
            sx={{ minWidth: { xs: '100%', sm: 140 }, flex: '1 1 140px' }}
            SelectProps={{
              displayEmpty: true,
              renderValue: (selected) => (selected ? String(selected) : 'All seasons')
            }}
          >
            <MenuItem value="">All seasons</MenuItem>
            {seasonOptions.map((season) => (
              <MenuItem key={season} value={String(season)}>
                {season}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            value={filters.state}
            onChange={(event) => handleFilterChange('state', event.target.value)}
            disabled={isFilterOptionsLoading}
            sx={{ minWidth: { xs: '100%', sm: 160 }, flex: '1 1 160px' }}
            SelectProps={{
              displayEmpty: true,
              renderValue: (selected) => selected || 'All states'
            }}
          >
            <MenuItem value="">All states</MenuItem>
            {stateOptions.map((state) => (
              <MenuItem key={state} value={state}>
                {state}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            value={filters.county}
            onChange={(event) => handleFilterChange('county', event.target.value)}
            disabled={!filters.state || isCountyLoading}
            sx={{ minWidth: { xs: '100%', sm: 160 }, flex: '1 1 160px' }}
            SelectProps={{
              displayEmpty: true,
              renderValue: (selected) => selected || 'All counties'
            }}
          >
            <MenuItem value="">All counties</MenuItem>
            {countyOptions.map((county) => (
              <MenuItem key={county} value={county}>
                {county}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="outlined"
            onClick={clearAllFilters}
            disabled={!hasActiveFilters || isLoading}
            sx={{
              borderColor: accentBlue,
              color: theme.palette.primary.main,
              bgcolor: alpha(theme.palette.primary.main, 0.08),
              minWidth: 120,
              whiteSpace: 'nowrap',
              flexShrink: 0,
              ml: { lg: 'auto' },
              '&.Mui-disabled': {
                backgroundColor: theme.palette.grey[500],
                color: alpha(theme.palette.text.primary, 0.5),
                borderColor: 'transparent'
              },
              '&:hover': {
                borderColor: theme.palette.primary.main,
                bgcolor: alpha(theme.palette.primary.main, 0.2),
                boxShadow: `0 0 0 1px ${alpha(theme.palette.primary.main, 0.45)}`
              }
            }}
          >
            Clear Filters
          </Button>
        </Stack>

        <TableContainer
          sx={{
            width: '100%',
            overflowX: 'auto',
            overflowY: 'auto',
            maxHeight: { xs: 420, md: 500 },
            border: 2,
            borderColor: accentBlue,
            borderRadius: 1,
            bgcolor: 'background.paper',
            boxShadow: `0 10px 30px ${alpha(theme.palette.primary.main, 0.14)}`,
            ...tableScrollbarSx
          }}
        >
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow
                sx={{
                  '& .MuiTableCell-root': {
                    borderBottomWidth: 3,
                    borderBottomColor: accentBlue,
                    bgcolor: headerBlue,
                    color: theme.palette.text.primary
                  },
                  '& .MuiTableSortLabel-root': {
                    color: `${theme.palette.text.primary} !important`
                  },
                  '& .MuiTableSortLabel-icon': {
                    color: `${theme.palette.text.primary} !important`
                  }
                }}
              >
                {columns.map((column) => (
                  <TableCell key={column.id} sortDirection={orderBy === column.id ? order : false} sx={{ whiteSpace: 'nowrap' }}>
                    <TableSortLabel
                      active={orderBy === column.id}
                      direction={orderBy === column.id ? order : 'asc'}
                      onClick={() => handleRequestSort(column.id)}
                    >
                      {column.label}
                    </TableSortLabel>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>

            <TableBody>
              {visibleRows.map((row) => (
                <TableRow
                  key={row.rowId}
                  hover
                  sx={{
                    bgcolor: rowSurface,
                    '&:hover': {
                      bgcolor: alpha(theme.palette.primary.main, 0.14)
                    }
                  }}
                >
                  <TableCell>{row.fieldId}</TableCell>
                  <TableCell>{row.crop}</TableCell>
                  <TableCell>{formatMetric(row.acres, 2)}</TableCell>
                  <TableCell>{row.variety}</TableCell>
                  <TableCell>{row.season}</TableCell>
                  <TableCell>{row.location}</TableCell>
                  <TableCell>{formatMetric(row.observedYield)}</TableCell>
                  <TableCell>{formatMetric(row.n)}</TableCell>
                  <TableCell>{formatMetric(row.p)}</TableCell>
                  <TableCell>{formatMetric(row.k)}</TableCell>
                </TableRow>
              ))}
              {!isLoading && visibleRows.length === 0 ? (
                <TableRow sx={{ bgcolor: rowSurface }}>
                  <TableCell colSpan={columns.length}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                      No records match the current filters.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}
              {isLoading && visibleRows.length === 0 ? (
                <TableRow sx={{ bgcolor: rowSurface }}>
                  <TableCell colSpan={columns.length}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                      Loading field records for selected filters...
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </TableContainer>

        <Stack direction="row" sx={{ width: '100%', gap: 1.25, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          {!isLoading ? (
            <Chip
              size="small"
              color="default"
              variant="outlined"
              label={`${sortedRows.length} shown on page ${page + 1} (${totalRows.toLocaleString()} total)`}
            />
          ) : (
            <Typography variant="body2" color="text.secondary">
              Loading records...
            </Typography>
          )}
          <Button
            variant="contained"
            startIcon={<DownloadOutlined />}
            onClick={handleDownload}
            disabled={isDownloading || isLoading}
            sx={{
              '&.Mui-disabled': {
                backgroundColor: theme.palette.grey[500],
                color: alpha(theme.palette.text.primary, 0.5)
              }
            }}
          >
            {isDownloading ? 'Downloading...' : downloadLabel}
          </Button>
        </Stack>

        <TablePagination
          component="div"
          count={totalRows}
          page={page}
          onPageChange={handleChangePage}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={handleChangeRowsPerPage}
          rowsPerPageOptions={[25, 50, 100, 250, 500]}
          sx={{ mt: -0.75 }}
        />
      </Stack>
    </MainCard>
  );
}
