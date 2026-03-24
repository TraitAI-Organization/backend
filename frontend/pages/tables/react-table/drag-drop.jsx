// material-ui
import Grid from '@mui/material/Grid2';

// project imports
import RowDragDrop from 'sections/tables/react-table/RowDragDrop';
import ColumnDragDrop from 'sections/tables/react-table/ColumnDragDrop';

// ==============================|| REACT TABLE - DRAG & DROP ||============================== //

export default function DragDrop() {
  return (
    <Grid container spacing={3}>
      <Grid size={12}>
        <RowDragDrop />
      </Grid>
      <Grid size={12}>
        <ColumnDragDrop />
      </Grid>
    </Grid>
  );
}
