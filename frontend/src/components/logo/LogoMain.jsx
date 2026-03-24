import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import logo from 'assets/images/logo.png';

// ==============================|| LOGO ||============================== //

export default function LogoMain() {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1.25, minHeight: { xs: 44, sm: 48, md: 52 } }}>
      <Box component="img" src={logo} alt="AgIntellect Studio logo" sx={{ width: 40, height: 40, objectFit: 'contain' }} />
      <Typography
        variant="subtitle1"
        noWrap
        sx={{ fontWeight: 700, fontSize: { xs: '1.1rem', sm: '1.2rem', md: '1.3rem' }, lineHeight: { xs: 1.35, sm: 1.4, md: 1.45 } }}
      >
        TraitHarvest AI
      </Typography>
    </Stack>
  );
}
