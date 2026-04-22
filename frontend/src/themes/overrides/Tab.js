// project imports
import { withAlpha } from 'utils/colorUtils';

// ==============================|| OVERRIDES - TAB ||============================== //

export default function Tab(theme) {
  return {
    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 46,
          color: theme.vars.palette.text.primary,
          borderRadius: 4,
          fontSize: '0.85rem',
          '@media (min-width:768px)': {
            fontSize: '0.875rem'
          },
          '@media (min-width:1024px)': {
            fontSize: '0.9rem'
          },
          '@media (min-width:1266px)': {
            fontSize: '0.925rem'
          },
          '@media (min-width:1440px)': {
            fontSize: '0.95rem'
          },
          '&:hover': {
            backgroundColor: withAlpha(theme.vars.palette.primary.main, 0.24),
            color: theme.vars.palette.primary.main
          },
          '&:focus-visible': {
            borderRadius: 4,
            outline: `2px solid ${theme.vars.palette.secondary.dark}`,
            outlineOffset: -3
          }
        }
      }
    }
  };
}
