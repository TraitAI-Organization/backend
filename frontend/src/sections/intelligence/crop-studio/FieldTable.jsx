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
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';

import MainCard from 'components/MainCard';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

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

async function fetchFieldRows(signal) {
  const params = new URLSearchParams({
    page: '1',
    limit: '500'
  });
  const response = await fetch(`${API_BASE_URL}/fields?${params.toString()}`, { signal });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to load field records (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];

  return rows.map((row) => ({
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
  }));
}

function formatMetric(value, decimals = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toFixed(decimals);
}

export default function FieldTable() {
  const theme = useTheme();
  const accentBlue = alpha(theme.palette.primary.main, 0.45);
  const headerBlue = `color-mix(in srgb, ${theme.palette.primary.main} 45%, ${theme.palette.background.paper})`;
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
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    const loadRows = async () => {
      setIsLoading(true);
      setLoadError('');
      try {
        const data = await fetchFieldRows(controller.signal);
        setRows(data);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setLoadError(error.message || 'Failed to load field records.');
          setRows([]);
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadRows();

    return () => {
      controller.abort();
    };
  }, []);

  const filteredRows = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLowerCase();

    return rows.filter((row) =>
      !normalizedSearch ? true : Object.values(row).some((value) => String(value).toLowerCase().includes(normalizedSearch))
    );
  }, [rows, searchValue]);

  const sortedRows = useMemo(() => [...filteredRows].sort(getComparator(order, orderBy)), [filteredRows, order, orderBy]);

  const handleRequestSort = (columnId) => {
    const isAsc = orderBy === columnId && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(columnId);
  };

  const handleDownload = () => {
    const header = columns.map((column) => column.label).join(',');
    const body = sortedRows
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
  };

  return (
    <MainCard title="Field Records">
      <Stack spacing={2}>
        <Typography variant="body1" color="text.primary">
          Sortable table of field-season records (crop, acres, variety, season, location, observed yield, N/P/K) filtered by topbar.
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
            Download
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
                <TableRow key={row.rowId} hover>
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
                <TableRow>
                  <TableCell colSpan={columns.length}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                      No records match the current search and filters.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}
              {isLoading ? (
                <TableRow>
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
      </Stack>
    </MainCard>
  );
}
