import { useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';

import MainCard from 'components/MainCard';
import Analytics from 'sections/intelligence/crop-studio/Analytics';
// import DataUpload from 'sections/intelligence/crop-studio/DataUpload';
import FieldTable from 'sections/intelligence/crop-studio/FieldTable';
// import MapView from 'sections/intelligence/crop-studio/MapView';
import Overview from 'sections/intelligence/crop-studio/Overview';
import Predict from 'sections/intelligence/crop-studio/Predict';

function TabPanel({ children, value, index }) {
  return (
    <div role="tabpanel" hidden={value !== index} id={`crop-studio-tabpanel-${index}`} aria-labelledby={`crop-studio-tab-${index}`}>
      {value === index ? <Box sx={{ pt: 0 }}>{children}</Box> : null}
    </div>
  );
}

export default function CropStudioDefault() {
  const [tabValue, setTabValue] = useState(0);

  const tabs = useMemo(
    () => [
      { label: 'Overview', component: <Overview /> },
      { label: 'Field Records', component: <FieldTable /> },
      // { label: 'Map View', component: <MapView /> },
      { label: 'Predict', component: <Predict /> },
      { label: 'Analytics', component: <Analytics /> }

      // { label: 'Data Upload', component: <DataUpload /> }
    ],
    []
  );

  const handleChange = (_, newValue) => {
    setTabValue(newValue);
  };

  return (
    <MainCard content={false}>
      <Tabs
        value={tabValue}
        onChange={handleChange}
        variant="scrollable"
        scrollButtons="auto"
        aria-label="crop studio navigation tabs"
        sx={{ mt: 2, px: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        {tabs.map((tab, index) => (
          <Tab key={tab.label} id={`crop-studio-tab-${index}`} aria-controls={`crop-studio-tabpanel-${index}`} label={tab.label} />
        ))}
      </Tabs>
      <Box sx={{ p: 3 }}>
        {tabs.map((tab, index) => (
          <TabPanel key={tab.label} value={tabValue} index={index}>
            {tab.component}
          </TabPanel>
        ))}
      </Box>
    </MainCard>
  );
}
