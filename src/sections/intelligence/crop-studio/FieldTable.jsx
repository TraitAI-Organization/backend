import { useMemo, useState } from 'react';

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
import Box from '@mui/material/Box';

import MainCard from 'components/MainCard';

const columns = [
  { id: 'fieldId', label: 'Field ID' },
  { id: 'crop', label: 'Crop' },
  { id: 'variety', label: 'Variety' },
  { id: 'season', label: 'Season' },
  { id: 'location', label: 'Location' },
  { id: 'observedYield', label: 'Observed Yield (bu/ac)' },
  { id: 'predictedYield', label: 'Predicted Yield (bu/ac)' },
  { id: 'n', label: 'N (lb/ac)' },
  { id: 'p', label: 'P (lb/ac)' },
  { id: 'k', label: 'K (lb/ac)' }
];

const mockRows = [
  {
    fieldId: 1001,
    crop: 'Sorghum',
    variety: 'SG-21',
    season: 2024,
    location: 'Finney, KS',
    observedYield: 88.6,
    predictedYield: 90.2,
    n: 142,
    p: 48,
    k: 76
  },
  {
    fieldId: 1002,
    crop: 'Winter Wheat',
    variety: 'HW-74',
    season: 2024,
    location: 'Salina, KS',
    observedYield: 73.2,
    predictedYield: 71.9,
    n: 126,
    p: 52,
    k: 69
  },
  {
    fieldId: 1003,
    crop: 'Corn',
    variety: 'CR-310',
    season: 2025,
    location: 'Polk, IA',
    observedYield: 109.1,
    predictedYield: 107.8,
    n: 168,
    p: 61,
    k: 92
  },
  {
    fieldId: 1004,
    crop: 'Soybean',
    variety: 'SB-8',
    season: 2025,
    location: 'Hall, NE',
    observedYield: 66.5,
    predictedYield: 68.1,
    n: 98,
    p: 44,
    k: 57
  },
  {
    fieldId: 1005,
    crop: 'Grain',
    variety: 'GR-5',
    season: 2023,
    location: 'Kingfisher, OK',
    observedYield: 64.7,
    predictedYield: 63.4,
    n: 118,
    p: 40,
    k: 62
  },
  {
    fieldId: 1006,
    crop: 'Winter Wheat',
    variety: 'HW-92',
    season: 2022,
    location: 'Scurry, TX',
    observedYield: 58.9,
    predictedYield: 60.5,
    n: 112,
    p: 39,
    k: 55
  },
  {
    fieldId: 1007,
    crop: 'Sorghum',
    variety: 'SG-18',
    season: 2023,
    location: 'Morton, KS',
    observedYield: 84.2,
    predictedYield: 83.7,
    n: 138,
    p: 46,
    k: 73
  },
  {
    fieldId: 1008,
    crop: 'Corn',
    variety: 'CR-502',
    season: 2024,
    location: 'Buffalo, NE',
    observedYield: 102.3,
    predictedYield: 100.1,
    n: 160,
    p: 58,
    k: 89
  }
];

function descendingComparator(a, b, orderBy) {
  if (b[orderBy] < a[orderBy]) return -1;
  if (b[orderBy] > a[orderBy]) return 1;
  return 0;
}

function getComparator(order, orderBy) {
  return order === 'desc' ? (a, b) => descendingComparator(a, b, orderBy) : (a, b) => -descendingComparator(a, b, orderBy);
}

export default function FieldTable() {
  const [order, setOrder] = useState('asc');
  const [orderBy, setOrderBy] = useState('fieldId');
  const [searchValue, setSearchValue] = useState('');

  const filteredRows = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLowerCase();

    return mockRows.filter((row) =>
      !normalizedSearch ? true : Object.values(row).some((value) => String(value).toLowerCase().includes(normalizedSearch))
    );
  }, [searchValue]);

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
            const cell = String(row[column.id]);
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
          Sortable table of field-season records (crop, variety, season, location, observed/predicted yield, N/P/K) filtered by topbar.
        </Typography>

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
          <Button variant="outlined" startIcon={<DownloadOutlined />} onClick={handleDownload}>
            Download
          </Button>
        </Stack>

        <TableContainer
          sx={{
            width: '100%',
            overflowX: 'auto',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            bgcolor: 'background.paper'
          }}
        >
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& .MuiTableCell-root': { borderBottomWidth: 3 } }}>
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
                <TableRow key={row.fieldId} hover>
                  <TableCell>{row.fieldId}</TableCell>
                  <TableCell>{row.crop}</TableCell>
                  <TableCell>{row.variety}</TableCell>
                  <TableCell>{row.season}</TableCell>
                  <TableCell>{row.location}</TableCell>
                  <TableCell>{row.observedYield.toFixed(1)}</TableCell>
                  <TableCell>{row.predictedYield.toFixed(1)}</TableCell>
                  <TableCell>{row.n}</TableCell>
                  <TableCell>{row.p}</TableCell>
                  <TableCell>{row.k}</TableCell>
                </TableRow>
              ))}
              {sortedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                      No records match the current search and filters.
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
