// third-party
import { presetPalettes } from '@ant-design/colors';

// project imports
import ThemeOption from './theme';
import { extendPaletteWithChannels } from 'utils/colorUtils';

const greyAscent = ['#fafafa', '#bfbfbf', '#434343', '#1f1f1f'];

// ==============================|| GREY COLORS BUILDER ||============================== //

function buildGrey() {
  let greyPrimary = [
    '#ffffff',
    '#fafafa',
    '#f5f5f5',
    '#f0f0f0',
    '#d9d9d9',
    '#bfbfbf',
    '#8c8c8c',
    '#595959',
    '#262626',
    '#141414',
    '#000000'
  ];
  let greyConstant = ['#fafafb', '#e6ebf1'];

  return [...greyPrimary, ...greyAscent, ...greyConstant];
}

// ==============================|| DEFAULT THEME - PALETTE ||============================== //

export function buildPalette(presetColor) {
  const lightColors = { ...presetPalettes, grey: buildGrey() };
  const lightPaletteColor = ThemeOption(lightColors, presetColor);
  const appTextColor = '#ffffff';
  const obsidian = '#010608';
  const cardSurface = '#050D12';
  const borderBlue = 'rgb(48, 67, 87)';

  const commonColor = { common: { black: '#000', white: '#fff' } };

  const extendedLight = extendPaletteWithChannels(lightPaletteColor);
  const extendedCommon = extendPaletteWithChannels(commonColor);

  return {
    light: {
      mode: 'light',
      ...extendedCommon,
      ...extendedLight,
      text: {
        primary: appTextColor,
        secondary: appTextColor,
        disabled: 'rgba(255, 255, 255, 0.55)'
      },
      action: {
        disabled: extendedLight.grey[300],
        hover: 'rgba(50, 103, 142, 0.22)',
        selected: 'rgba(50, 103, 142, 0.30)',
        focus: 'rgba(50, 103, 142, 0.36)'
      },
      divider: borderBlue,
      background: {
        paper: cardSurface,
        default: obsidian
      }
    }
  };
}
