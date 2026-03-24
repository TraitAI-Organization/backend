// material-ui
import Grid from '@mui/material/Grid2';

// project imports
import BasicTable from 'sections/tables/react-table/BasicTable';
import FooterTable from 'sections/tables/react-table/FooterTable';

// ==============================|| REACT TABLE - BASIC ||============================== //

export default function Basic() {
  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, lg: 6 }}>
        <BasicTable title="Basic Table" />
      </Grid>
      <Grid size={{ xs: 12, lg: 6 }}>
        <BasicTable title="Striped Table" striped />
      </Grid>
      <Grid size={12}>
        <FooterTable />
      </Grid>
    </Grid>
  );
}
