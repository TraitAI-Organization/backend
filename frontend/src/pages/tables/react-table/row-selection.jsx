// material-ui
import Grid from '@mui/material/Grid2';

// project imports
import RowSelectionTable from 'sections/tables/react-table/RowSelectionTable';
import RSPControl from 'sections/tables/react-table/RSPControl';

// ==============================|| REACT TABLE - ROW SELECTION ||============================== //

export default function RowSelection() {
  return (
    <Grid container spacing={3}>
      <Grid size={12}>
        <RowSelectionTable />
      </Grid>
      <Grid size={12}>
        <RSPControl />
      </Grid>
    </Grid>
  );
}
