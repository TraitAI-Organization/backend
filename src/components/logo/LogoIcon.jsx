import Box from '@mui/material/Box';
import logo from 'assets/images/logo.png';

// ==============================|| LOGO ICON ||============================== //

export default function LogoIcon() {
  return <Box component="img" src={logo} alt="TraitHarvestAI logo" sx={{ width: 35, height: 35, objectFit: 'contain' }} />;
}
