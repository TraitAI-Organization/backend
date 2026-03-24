import { useState } from 'react';

// material-ui
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemAvatar from '@mui/material/ListItemAvatar';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// project imports
import MainCard from 'components/MainCard';
import AnalyticEcommerce from 'components/cards/statistics/AnalyticEcommerce';
import OrdersTable from 'sections/overview/dashboard/default/OrdersTable';

// assets
import EllipsisOutlined from '@ant-design/icons/EllipsisOutlined';
import GiftOutlined from '@ant-design/icons/GiftOutlined';
import MessageOutlined from '@ant-design/icons/MessageOutlined';
import SettingOutlined from '@ant-design/icons/SettingOutlined';

const keyDates = [
  {
    id: 'planting',
    title: 'Planting Date',
    date: 'March 28, 2025',
    icon: <GiftOutlined />,
    color: 'primary.main',
    bg: 'primary.lighter'
  },
  {
    id: 'first-fertilizer',
    title: 'First Fertilizer Date',
    date: 'April 14, 2025',
    icon: <MessageOutlined />,
    color: 'warning.main',
    bg: 'warning.lighter'
  },
  {
    id: 'harvest',
    title: 'Harvest Date',
    date: 'September 19, 2025',
    icon: <SettingOutlined />,
    color: 'success.main',
    bg: 'success.lighter'
  }
];

const dashboardCardGlowSx = {
  boxShadow: '0 0 0 1px rgba(49, 93, 125, 0.14), 0 0 8px rgba(50, 103, 142, 0.18), 0 0 14px rgba(199, 236, 240, 0.10)'
};

// ==============================|| DASHBOARD - DEFAULT ||============================== //

export default function DashboardDefault() {
  const [eventsMenuAnchor, setEventsMenuAnchor] = useState(null);

  const handleEventsMenuClick = (event) => {
    setEventsMenuAnchor(event.currentTarget);
  };

  const handleEventsMenuClose = () => {
    setEventsMenuAnchor(null);
  };

  return (
    <Grid container rowSpacing={4.5} columnSpacing={2.75}>
      <Grid sx={{ mb: -2.25 }} size={12}>
        <Typography variant="h5">Management Summary</Typography>
      </Grid>

      {/* row 1 */}
      <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
        <AnalyticEcommerce title="Total N Applied / Acre (lb)" count="142.6" percentage={6.3} extra="2.6" sx={dashboardCardGlowSx} />
      </Grid>
      <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
        <AnalyticEcommerce title="Total P Applied / Acre (lb)" count="54.3" percentage={2.1} extra="2.3" sx={dashboardCardGlowSx} />
      </Grid>
      <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
        <AnalyticEcommerce title="Total K Applied / Acre (lb)" count="87.9" percentage={3.4} extra="2.9" sx={dashboardCardGlowSx} />
      </Grid>

      {/* row 2 */}
      <Grid size={{ xs: 12, md: 7, lg: 8 }} sx={{ display: 'flex', flexDirection: 'column' }}>
        <Stack direction="row" sx={{ minHeight: 42, alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h5">Management Events</Typography>
          <Box>
            <IconButton onClick={handleEventsMenuClick}>
              <EllipsisOutlined style={{ fontSize: '1.25rem' }} />
            </IconButton>
            <Menu
              id="management-events-menu"
              slotProps={{ list: { 'aria-labelledby': 'management-events-menu' } }}
              anchorEl={eventsMenuAnchor}
              onClose={handleEventsMenuClose}
              open={Boolean(eventsMenuAnchor)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              <MenuItem onClick={handleEventsMenuClose}>Export as CSV</MenuItem>
              <MenuItem onClick={handleEventsMenuClose}>Export as Excel</MenuItem>
              <MenuItem onClick={handleEventsMenuClose}>Print Table</MenuItem>
            </Menu>
          </Box>
        </Stack>
        <MainCard sx={{ mt: 2, flexGrow: 1, ...dashboardCardGlowSx }} content={false}>
          <OrdersTable />
        </MainCard>
      </Grid>

      <Grid size={{ xs: 12, md: 5, lg: 4 }} sx={{ display: 'flex', flexDirection: 'column' }}>
        <Stack direction="row" sx={{ minHeight: 42, alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h5">Key Dates</Typography>
          <Box sx={{ width: 40 }} />
        </Stack>
        <MainCard sx={{ mt: 2, flexGrow: 1, ...dashboardCardGlowSx }} content={false}>
          <List
            component="nav"
            sx={{
              px: 0,
              py: 0,
              '& .MuiListItemButton-root': {
                py: 1.75,
                px: 2
              }
            }}
          >
            {keyDates.map((entry, index) => (
              <ListItem key={entry.id} component={ListItemButton} divider={index !== keyDates.length - 1}>
                <ListItemAvatar>
                  <Avatar sx={{ color: entry.color, bgcolor: entry.bg }}>{entry.icon}</Avatar>
                </ListItemAvatar>
                <ListItemText primary={<Typography variant="subtitle1">{entry.title}</Typography>} secondary={entry.date} />
              </ListItem>
            ))}
          </List>
        </MainCard>
      </Grid>
    </Grid>
  );
}
