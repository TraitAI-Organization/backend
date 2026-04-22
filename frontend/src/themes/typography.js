// ==============================|| DEFAULT THEME - TYPOGRAPHY ||============================== //

export default function Typography(fontFamily) {
  const responsiveSize = (xs, sm, md, lg, xl) => ({
    fontSize: xs,
    '@media (min-width:768px)': { fontSize: sm },
    '@media (min-width:1024px)': { fontSize: md },
    '@media (min-width:1266px)': { fontSize: lg },
    '@media (min-width:1440px)': { fontSize: xl }
  });

  return {
    htmlFontSize: 16,
    fontFamily,
    fontWeightLight: 300,
    fontWeightRegular: 400,
    fontWeightMedium: 500,
    fontWeightBold: 600,
    h1: {
      fontWeight: 600,
      ...responsiveSize('2.38rem', '2.405rem', '2.43rem', '2.455rem', '2.48rem'),
      lineHeight: 1.21
    },
    h2: {
      fontWeight: 600,
      ...responsiveSize('1.88rem', '1.905rem', '1.93rem', '1.955rem', '1.98rem'),
      lineHeight: 1.27
    },
    h3: {
      fontWeight: 600,
      ...responsiveSize('1.505rem', '1.53rem', '1.555rem', '1.58rem', '1.605rem'),
      lineHeight: 1.33
    },
    h4: {
      fontWeight: 600,
      ...responsiveSize('1.505rem', '1.53rem', '1.555rem', '1.58rem', '1.605rem'),
      lineHeight: 1.4
    },
    h5: {
      fontWeight: 600,
      ...responsiveSize('1.005rem', '1.03rem', '1.055rem', '1.08rem', '1.105rem'),
      lineHeight: 1.5
    },
    h6: {
      fontWeight: 400,
      ...responsiveSize('0.88rem', '0.905rem', '0.93rem', '0.955rem', '0.98rem'),
      lineHeight: 1.57
    },
    caption: {
      fontWeight: 400,
      ...responsiveSize('0.755rem', '0.78rem', '0.805rem', '0.83rem', '0.855rem'),
      lineHeight: 1.66
    },
    body1: {
      ...responsiveSize('0.88rem', '0.905rem', '0.93rem', '0.955rem', '0.98rem'),
      lineHeight: 1.57
    },
    body2: {
      ...responsiveSize('0.825rem', '0.85rem', '0.875rem', '0.9rem', '0.925rem'),
      lineHeight: 1.66
    },
    subtitle1: {
      ...responsiveSize('0.98rem', '1.005rem', '1.03rem', '1.055rem', '1.08rem'),
      fontWeight: 600,
      lineHeight: 1.57
    },
    subtitle2: {
      ...responsiveSize('0.755rem', '0.78rem', '0.805rem', '0.83rem', '0.855rem'),
      fontWeight: 500,
      lineHeight: 1.66
    },
    overline: {
      lineHeight: 1.66
    },
    button: {
      textTransform: 'capitalize'
    }
  };
}
