// material-ui
import Grid from '@mui/material/Grid2';

// project imports
import EditableCell from 'sections/tables/react-table/EditableCell';
import EditableRow from 'sections/tables/react-table/EditableRow';

// ==============================|| REACT TABLE - EDITABLE ||============================== //

export default function EditableTable() {
  return (
    <Grid container spacing={3}>
      <Grid size={12}>
        <EditableRow />
      </Grid>
      <Grid size={12}>
        <EditableCell />
      </Grid>
    </Grid>
  );
}
