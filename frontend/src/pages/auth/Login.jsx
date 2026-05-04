// material-ui
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// project imports
import Logo from 'components/logo';
import AuthFooter from 'components/cards/AuthFooter';
import AuthLogin from 'sections/auth/AuthLogin';
import AuthHero from 'sections/auth/AuthHero';

// ================================|| LOGIN ||================================ //

export default function Login() {
  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: 'background.default' }}>
      <Grid container sx={{ minHeight: '100vh' }}>
        {/* LEFT — username / password */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Stack
            sx={{
              minHeight: '100vh',
              px: { xs: 3, sm: 6, md: 6, lg: 8 },
              py: { xs: 4, sm: 5, md: 5 }
            }}
          >
            <Box>
              <Logo to="/" />
            </Box>

            <Box
              sx={{
                flexGrow: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                py: { xs: 4, md: 6 }
              }}
            >
              <Box sx={{ width: '100%', maxWidth: 420 }}>
                <Stack spacing={1} sx={{ mb: 4 }}>
                  <Typography variant="h3" sx={{ fontWeight: 600, letterSpacing: '-0.01em' }}>
                    Welcome back
                  </Typography>
                  <Typography variant="body1" sx={{ color: 'rgba(255, 255, 255, 0.65)' }}>
                    Sign in to continue to TraitHarvest.
                  </Typography>
                </Stack>

                <AuthLogin />
              </Box>
            </Box>

            <Box>
              <AuthFooter />
            </Box>
          </Stack>
        </Grid>

        {/* RIGHT — title + hook (hidden on small screens) */}
        <Grid size={{ xs: 12, md: 6 }} sx={{ display: { xs: 'none', md: 'block' } }}>
          <AuthHero />
        </Grid>
      </Grid>
    </Box>
  );
}
