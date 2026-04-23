import { useEffect, useMemo, useState } from 'react';

import DownloadOutlined from '@ant-design/icons/DownloadOutlined';
import SearchOutlined from '@ant-design/icons/SearchOutlined';
import InputAdornment from '@mui/material/InputAdornment';
import Button from '@mui/material/Button';
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

async function fetchFieldRows(signal, page, limit) {
  const params = new URLSearchParams({
    page: String(page + 1),
    limit: String(limit)
  });
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

function matchesSearch(row, normalizedSearch) {
  return !normalizedSearch ? true : Object.values(row).some((value) => String(value).toLowerCase().includes(normalizedSearch));
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
  const [searchValue, setSearchValue] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [totalRows, setTotalRows] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    const loadRows = async () => {
      setIsLoading(true);
      setLoadError('');
      try {
        const result = await fetchFieldRows(controller.signal, page, rowsPerPage);
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
  }, [page, rowsPerPage]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLowerCase();
    return rows.filter((row) => matchesSearch(row, normalizedSearch));
  }, [rows, searchValue]);

  const sortedRows = useMemo(() => [...filteredRows].sort(getComparator(order, orderBy)), [filteredRows, order, orderBy]);

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
        const result = await fetchFieldRows(undefined, currentPage, DOWNLOAD_PAGE_SIZE);
        if (currentPage === 0) total = result.total;
        allRows.push(...result.rows);
        currentPage += 1;
        if (result.rows.length === 0) break;
      } while (allRows.length < total);

      const normalizedSearch = searchValue.trim().toLowerCase();
      const exportRows = allRows.filter((row) => matchesSearch(row, normalizedSearch)).sort(getComparator(order, orderBy));

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

  return (
    <MainCard title="Field Records">
      <Stack spacing={2}>
        <Typography variant="body1" color="text.primary">
          Sortable, paginated table of field-season records (crop, acres, variety, season, location, observed yield, N/P/K) filtered by
          topbar.
        </Typography>
        {loadError ? (
          <Typography variant="body2" color="error.main">
            {loadError}
          </Typography>
        ) : null}

        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1.5, justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
          <TextField
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Search records..."
            size="small"
            sx={{
              width: { xs: '100%', sm: 170 },
              '& .MuiOutlinedInput-root': {
                pr: 1
              },
              '& .MuiOutlinedInput-input': {
                py: 0.75,
                pl: 0.5,
                pr: 0.75
              },
              '& .MuiInputAdornment-positionStart': {
                mr: 0.5
              }
            }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchOutlined />
                  </InputAdornment>
                )
              }
            }}
          />
          <Button
            variant="outlined"
            startIcon={<DownloadOutlined />}
            onClick={handleDownload}
            sx={{
              borderColor: accentBlue,
              color: theme.palette.primary.main,
              bgcolor: alpha(theme.palette.primary.main, 0.08),
              '&:hover': {
                borderColor: theme.palette.primary.main,
                bgcolor: alpha(theme.palette.primary.main, 0.2),
                boxShadow: `0 0 0 1px ${alpha(theme.palette.primary.main, 0.45)}`
              }
            }}
          >
            {isDownloading ? 'Downloading...' : 'Download'}
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
              {sortedRows.map((row) => (
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
              {!isLoading && sortedRows.length === 0 ? (
                <TableRow sx={{ bgcolor: rowSurface }}>
                  <TableCell colSpan={columns.length}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                      No records match the current search and filters.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}
              {isLoading ? (
                <TableRow sx={{ bgcolor: rowSurface }}>
                  <TableCell colSpan={columns.length}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                      Loading field records...
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination
          component="div"
          count={totalRows}
          page={page}
          onPageChange={handleChangePage}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={handleChangeRowsPerPage}
          rowsPerPageOptions={[25, 50, 100, 250, 500]}
        />
      </Stack>
    </MainCard>
  );
}
