// ==============================|| OVERRIDES - TABLE CELL ||============================== //

export default function TableHead(theme) {
  return {
    MuiTableHead: {
      styleOverrides: {
        root: {
          backgroundColor: '#040E14',
          borderTop: '1px solid',
          borderTopColor: 'rgb(48, 67, 87)',
          borderBottom: '2px solid',
          borderBottomColor: 'rgb(48, 67, 87)'
        }
      }
    }
  };
}
