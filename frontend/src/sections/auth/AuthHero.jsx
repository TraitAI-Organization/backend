// material-ui
import { useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// assets
import CheckCircleFilled from '@ant-design/icons/CheckCircleFilled';

// ==============================|| AUTH - HERO PANEL ||============================== //

const features = [
  'Field-level yield predictions with confidence intervals',
  'Trait decoding across crops, varieties, and seasons',
  'Explainable models you can trust in the field'
];

export default function AuthHero() {
  const theme = useTheme();

  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        minHeight: '100vh',
        backgroundColor: 'rgb(5, 13, 18)',
        borderLeft: '1px solid rgb(48, 67, 87)',
        overflow: 'hidden'
      }}
    >
      {/* Decorative blurred orb - primary */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          top: '-15%',
          right: '-10%',
          width: 560,
          height: 560,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${theme.vars.palette.primary.main} 0%, transparent 70%)`,
          opacity: 0.32,
          filter: 'blur(70px)'
        }}
      />

      {/* Decorative blurred orb - success (agricultural green) */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          bottom: '-12%',
          left: '-10%',
          width: 500,
          height: 500,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${theme.vars.palette.success.main} 0%, transparent 70%)`,
          opacity: 0.22,
          filter: 'blur(80px)'
        }}
      />

      {/* Subtle grid overlay */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(rgba(48,67,87,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(48,67,87,0.10) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(ellipse at center, #000 30%, transparent 80%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, #000 30%, transparent 80%)'
        }}
      />

      {/* Content */}
      <Stack
        sx={{
          position: 'relative',
          zIndex: 1,
          minHeight: '100vh',
          px: { md: 6, lg: 8, xl: 10 },
          py: { md: 6, lg: 8 },
          justifyContent: 'center'
        }}
        spacing={4}
      >
        <Stack spacing={2.5}>
          <Typography
            variant="overline"
            sx={{
              letterSpacing: 4,
              color: 'primary.light',
              fontSize: '0.8rem',
              fontWeight: 600
            }}
          >
            TRAITHARVEST
          </Typography>

          <Typography
            variant="h1"
            sx={{
              fontSize: { md: '2.75rem', lg: '3.4rem' },
              fontWeight: 700,
              lineHeight: 1.1,
              maxWidth: 540,
              letterSpacing: '-0.02em'
            }}
          >
            Agricultural intelligence,{' '}
            <Box
              component="span"
              sx={{
                background: `linear-gradient(90deg, ${theme.vars.palette.primary.light}, ${theme.vars.palette.success.light})`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text'
              }}
            >
              from soil to silo.
            </Box>
          </Typography>

          <Typography
            variant="body1"
            sx={{
              color: 'rgba(255, 255, 255, 0.72)',
              maxWidth: 500,
              fontSize: '1.05rem',
              lineHeight: 1.65
            }}
          >
            Predict yields, decode traits, and harvest insights from every field — season after season — with models grown on your data.
          </Typography>
        </Stack>

        <Stack spacing={1.75} sx={{ pt: 2 }}>
          {features.map((feature) => (
            <Stack key={feature} direction="row" spacing={1.5} alignItems="center">
              <CheckCircleFilled style={{ color: theme.vars.palette.success.main, fontSize: 18, flexShrink: 0 }} />
              <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.85)' }}>
                {feature}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </Stack>
    </Box>
  );
}
