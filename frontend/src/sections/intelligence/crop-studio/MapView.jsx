import { useMemo, useState } from 'react';

import { alpha, useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import MainCard from 'components/MainCard';

const FIELD_LOCATIONS = [
  { id: 1, name: 'North Pivot 12', crop: 'Sorghum', season: 2024, yield: 161.3, latitude: 39.2012, longitude: -96.5853 },
  { id: 2, name: 'West Ridge 3', crop: 'Winter Wheat', season: 2023, yield: 73.2, latitude: 38.4831, longitude: -97.1234 },
  { id: 3, name: 'South Creek 8', crop: 'Grain', season: 2024, yield: 129.4, latitude: 37.8921, longitude: -98.2042 },
  { id: 4, name: 'East Block 5', crop: 'Winter Wheat', season: 2022, yield: 68.9, latitude: 40.1186, longitude: -95.9208 },
  { id: 5, name: 'Central Flat 1', crop: 'Sorghum', season: 2025, yield: 172.6, latitude: 38.7791, longitude: -99.4427 }
];

function cropColor(crop, theme) {
  if (crop === 'Sorghum') return theme.palette.success.main;
  if (crop === 'Winter Wheat') return theme.palette.warning.main;
  return theme.palette.info.main;
}

export default function MapView() {
  const theme = useTheme();
  const [hoveredField, setHoveredField] = useState(FIELD_LOCATIONS[0]);

  const fields = useMemo(
    () =>
      FIELD_LOCATIONS.map((field) => ({
        ...field,
        color: cropColor(field.crop, theme)
      })),
    [theme]
  );

  const satelliteUrl = useMemo(() => {
    if (!hoveredField) return '';
    const ll = `${hoveredField.latitude},${hoveredField.longitude}`;
    return `https://maps.google.com/maps?output=embed&t=k&z=12&ll=${encodeURIComponent(ll)}`;
  }, [hoveredField]);

  return (
    <MainCard title="Map View">
      <Typography variant="body1" color="text.primary" sx={{ mb: 2 }}>
        Map of field locations (lat/long) with hover for crop, season, and yield.
      </Typography>
      <Box
        sx={{
          height: { xs: 420, md: 560 },
          borderRadius: 1.5,
          overflow: 'hidden',
          border: `1px solid ${theme.palette.divider}`,
          position: 'relative'
        }}
      >
        <iframe
          title="Field satellite map"
          src={satelliteUrl}
          width="100%"
          height="100%"
          style={{ border: 0 }}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />

        {hoveredField && (
          <Paper
            variant="outlined"
            sx={{
              position: 'absolute',
              left: 12,
              top: 12,
              p: 1.25,
              borderColor: 'divider',
              backgroundColor: alpha(theme.palette.background.paper, 0.9),
              backdropFilter: 'blur(2px)'
            }}
          >
            <Stack spacing={0.5}>
              <Typography variant="subtitle2">{hoveredField.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {hoveredField.latitude.toFixed(4)}, {hoveredField.longitude.toFixed(4)}
              </Typography>
              <Typography variant="body2">
                {hoveredField.crop} | Season {hoveredField.season} | {hoveredField.yield.toFixed(1)} bu/ac
              </Typography>
            </Stack>
          </Paper>
        )}

        <Paper
          variant="outlined"
          sx={{
            position: 'absolute',
            right: 12,
            top: 12,
            width: { xs: 'calc(100% - 24px)', sm: 380 },
            maxHeight: { xs: 220, md: 536 },
            overflow: 'auto',
            borderColor: 'divider',
            backgroundColor: alpha(theme.palette.background.paper, 0.92),
            backdropFilter: 'blur(2px)'
          }}
        >
          <Stack spacing={1} sx={{ p: 1.5 }}>
            <Typography variant="subtitle2" color="text.secondary">
              Mock Field Locations
            </Typography>
            {fields.map((field) => {
              const selected = hoveredField?.id === field.id;
              return (
                <Box
                  key={field.id}
                  onMouseEnter={() => setHoveredField(field)}
                  sx={{
                    p: 1.25,
                    borderRadius: 1,
                    cursor: 'pointer',
                    border: `1px solid ${selected ? field.color : theme.palette.divider}`,
                    bgcolor: selected ? alpha(field.color, 0.08) : 'background.paper',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                    {field.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {field.latitude.toFixed(4)}, {field.longitude.toFixed(4)}
                  </Typography>
                  <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: 'nowrap' }}>
                    <Chip size="small" label={field.crop} />
                    <Chip size="small" variant="outlined" label={`Season ${field.season}`} />
                    <Chip size="small" color="primary" label={`${field.yield.toFixed(1)} bu/ac`} />
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        </Paper>
      </Box>
    </MainCard>
  );
}
