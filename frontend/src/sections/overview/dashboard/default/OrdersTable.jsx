// material-ui
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

const rows = [
  { eventType: 'Harvesting', eventCount: 119, latestDate: 'Sep 19, 2025', avgRate: '4.8 ac/day', coverage: '91% of fields' },
  { eventType: 'Planting / Seeding', eventCount: 126, latestDate: 'Mar 28, 2025', avgRate: '5.6 ac/day', coverage: '98% of fields' },
  { eventType: 'Fertilizing', eventCount: 242, latestDate: 'Apr 14, 2025', avgRate: '142.6 lb/ac', coverage: '100% of fields' },
  { eventType: 'Spraying', eventCount: 188, latestDate: 'Jun 09, 2025', avgRate: '1.3 passes', coverage: '92% of fields' },
  { eventType: 'Irrigation', eventCount: 164, latestDate: 'Jul 03, 2025', avgRate: '26.7 mm/event', coverage: '86% of fields' }
];

const headCells = [
  { id: 'eventType', align: 'left', label: 'Event Type' },
  { id: 'eventCount', align: 'right', label: 'Event Count' },
  { id: 'latestDate', align: 'left', label: 'Latest Event Date' },
  { id: 'avgRate', align: 'left', label: 'Operational Metric' },
  { id: 'coverage', align: 'left', label: 'Coverage' }
];

// ==============================|| MANAGEMENT EVENT TABLE ||============================== //

export default function OrdersTable() {
  return (
    <Box>
      <TableContainer
        sx={{
          width: '100%',
          overflowX: 'auto',
          position: 'relative',
          display: 'block',
          maxWidth: '100%',
          '& td, & th': { whiteSpace: 'nowrap' }
        }}
      >
        <Table aria-labelledby="tableTitle">
          <TableHead>
            <TableRow>
              {headCells.map((headCell) => (
                <TableCell key={headCell.id} align={headCell.align}>
                  {headCell.label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.eventType} hover sx={{ '&:last-child td, &:last-child th': { border: 0 } }}>
                <TableCell component="th" scope="row">
                  <Stack>
                    <Typography variant="subtitle1">{row.eventType}</Typography>
                  </Stack>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="subtitle1">{row.eventCount}</Typography>
                </TableCell>
                <TableCell>{row.latestDate}</TableCell>
                <TableCell>{row.avgRate}</TableCell>
                <TableCell>{row.coverage}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
