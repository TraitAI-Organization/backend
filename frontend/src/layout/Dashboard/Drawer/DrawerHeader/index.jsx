import PropTypes from 'prop-types';

// project imports
import DrawerHeaderStyled from './DrawerHeaderStyled';
import Logo from 'components/logo';

// ==============================|| DRAWER HEADER ||============================== //

export default function DrawerHeader({ open }) {
  return (
    <DrawerHeaderStyled
      open={open}
      sx={(theme) => ({
        width: 'initial',
        borderBottom: '1px solid',
        marginTop: '1px',
        borderBottomColor: 'rgb(64, 102, 140)',
        boxSizing: 'border-box',
        paddingLeft: open ? '24px' : 0,
        minHeight: theme.mixins.toolbar.minHeight
      })}
    >
      <Logo isIcon={!open} sx={{ width: open ? 'auto' : 35, height: 35 }} />
    </DrawerHeaderStyled>
  );
}

DrawerHeader.propTypes = { open: PropTypes.bool };
