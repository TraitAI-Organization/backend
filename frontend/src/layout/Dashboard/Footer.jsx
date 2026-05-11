// material-ui
import { alpha, useTheme } from '@mui/material/styles';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

export default function Footer() {
  const theme = useTheme();
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      sx={{ gap: 1.5, alignItems: 'center', justifyContent: 'space-between', p: '24px 16px 0px', mt: 'auto' }}
    >
      <Typography variant="caption">
        &copy; All rights reserved{' '}
        <Link
          href="https://www.shakoorlab.com"
          target="_blank"
          underline="hover"
          sx={{
            color: theme.palette.primary.light,
            fontWeight: 700,
            transition: 'color 0.15s ease',
            '&:hover, &:focus-visible': { color: alpha(theme.palette.primary.light, 0.85) }
          }}
        >
          Shakoor Lab
        </Link>
      </Typography>
      <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="#" target="_blank" variant="caption" color="text.primary">
          About us
        </Link>
        <Link href="#" target="_blank" variant="caption" color="text.primary">
          Privacy
        </Link>
        <Link href="#" target="_blank" variant="caption" color="text.primary">
          Terms
        </Link>
      </Stack>
    </Stack>
  );
}
