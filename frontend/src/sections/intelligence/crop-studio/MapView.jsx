import { useEffect, useMemo, useState } from 'react';

import { alpha, useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import MainCard from 'components/MainCard';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');
const MAX_LOCATIONS = 15;
const US_CENTER = { latitude: 39.8283, longitude: -98.5795 };

const STATE_COORDINATES = {
  Alabama: { latitude: 32.806671, longitude: -86.79113 },
  Alaska: { latitude: 61.370716, longitude: -152.404419 },
  Arizona: { latitude: 33.729759, longitude: -111.431221 },
  Arkansas: { latitude: 34.969704, longitude: -92.373123 },
  California: { latitude: 36.116203, longitude: -119.681564 },
  Colorado: { latitude: 39.059811, longitude: -105.311104 },
  Connecticut: { latitude: 41.597782, longitude: -72.755371 },
  Delaware: { latitude: 39.318523, longitude: -75.507141 },
  Florida: { latitude: 27.766279, longitude: -81.686783 },
  Georgia: { latitude: 33.040619, longitude: -83.643074 },
  Hawaii: { latitude: 21.094318, longitude: -157.498337 },
  Idaho: { latitude: 44.240459, longitude: -114.478828 },
  Illinois: { latitude: 40.349457, longitude: -88.986137 },
  Indiana: { latitude: 39.849426, longitude: -86.258278 },
  Iowa: { latitude: 42.011539, longitude: -93.210526 },
  Kansas: { latitude: 38.5266, longitude: -96.726486 },
  Kentucky: { latitude: 37.66814, longitude: -84.670067 },
  Louisiana: { latitude: 31.169546, longitude: -91.867805 },
  Maine: { latitude: 44.693947, longitude: -69.381927 },
  Maryland: { latitude: 39.063946, longitude: -76.802101 },
  Massachusetts: { latitude: 42.230171, longitude: -71.530106 },
  Michigan: { latitude: 43.326618, longitude: -84.536095 },
  Minnesota: { latitude: 45.694454, longitude: -93.900192 },
  Mississippi: { latitude: 32.741646, longitude: -89.678696 },
  Missouri: { latitude: 38.456085, longitude: -92.288368 },
  Montana: { latitude: 46.921925, longitude: -110.454353 },
  Nebraska: { latitude: 41.12537, longitude: -98.268082 },
  Nevada: { latitude: 38.313515, longitude: -117.055374 },
  'New Hampshire': { latitude: 43.452492, longitude: -71.563896 },
  'New Jersey': { latitude: 40.298904, longitude: -74.521011 },
  'New Mexico': { latitude: 34.840515, longitude: -106.248482 },
  'New York': { latitude: 42.165726, longitude: -74.948051 },
  'North Carolina': { latitude: 35.630066, longitude: -79.806419 },
  'North Dakota': { latitude: 47.528912, longitude: -99.784012 },
  Ohio: { latitude: 40.388783, longitude: -82.764915 },
  Oklahoma: { latitude: 35.565342, longitude: -96.928917 },
  Oregon: { latitude: 44.572021, longitude: -122.070938 },
  Pennsylvania: { latitude: 40.590752, longitude: -77.209755 },
  'Rhode Island': { latitude: 41.680893, longitude: -71.51178 },
  'South Carolina': { latitude: 33.856892, longitude: -80.945007 },
  'South Dakota': { latitude: 44.299782, longitude: -99.438828 },
  Tennessee: { latitude: 35.747845, longitude: -86.692345 },
  Texas: { latitude: 31.054487, longitude: -97.563461 },
  Utah: { latitude: 40.150032, longitude: -111.862434 },
  Vermont: { latitude: 44.045876, longitude: -72.710686 },
  Virginia: { latitude: 37.769337, longitude: -78.169968 },
  Washington: { latitude: 47.400902, longitude: -121.490494 },
  'West Virginia': { latitude: 38.491226, longitude: -80.954453 },
  Wisconsin: { latitude: 44.268543, longitude: -89.616508 },
  Wyoming: { latitude: 42.755966, longitude: -107.30249 }
};

const STATE_ABBR_TO_NAME = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming'
};

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function resolveStateCoordinates(stateValue) {
  const rawState = stateValue?.trim();
  if (!rawState) return US_CENTER;
  const normalizedState = rawState.length === 2 ? STATE_ABBR_TO_NAME[rawState.toUpperCase()] || rawState : rawState;
  return STATE_COORDINATES[normalizedState] || US_CENTER;
}

async function fetchMapFields(signal) {
  const params = new URLSearchParams({
    page: '1',
    limit: String(MAX_LOCATIONS)
  });
  const response = await fetch(`${API_BASE_URL}/fields?${params.toString()}`, { signal });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to load map locations (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data.slice(0, MAX_LOCATIONS) : [];

  return rows.map((row, index) => {
    const latFromField = toNumberOrNull(row.lat);
    const longFromField = toNumberOrNull(row.long);
    const stateCoords = resolveStateCoordinates(row.state);
    const latitude = latFromField ?? stateCoords.latitude;
    const longitude = longFromField ?? stateCoords.longitude;
    const yieldValue = toNumberOrNull(row.yield_bu_ac) ?? toNumberOrNull(row.predicted_yield);

    return {
      id: row.field_season_id ?? row.field_number ?? `field-${index + 1}`,
      name: row.field_number ? `Field ${row.field_number}` : `Field ${index + 1}`,
      crop: row.crop || 'Unknown',
      season: row.season ?? 'N/A',
      yield: yieldValue,
      latitude,
      longitude,
      usedStateFallback: latFromField === null || longFromField === null,
      state: row.state || 'N/A',
      county: row.county || 'N/A'
    };
  });
}

function cropColor(crop, theme) {
  if (crop === 'Sorghum') return theme.palette.success.main;
  if (crop === 'Winter Wheat') return theme.palette.warning.main;
  return theme.palette.info.main;
}

export default function MapView() {
  const theme = useTheme();
  const [fields, setFields] = useState([]);
  const [hoveredField, setHoveredField] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    const loadMapFields = async () => {
      setIsLoading(true);
      setLoadError('');
      try {
        const data = await fetchMapFields(controller.signal);
        setFields(data);
        setHoveredField(data[0] ?? null);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setLoadError(error.message || 'Failed to load map locations.');
          setFields([]);
          setHoveredField(null);
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadMapFields();

    return () => {
      controller.abort();
    };
  }, []);

  const fieldsWithColor = useMemo(
    () =>
      fields.map((field) => ({
        ...field,
        color: cropColor(field.crop, theme)
      })),
    [fields, theme]
  );

  const satelliteUrl = useMemo(() => {
    if (!hoveredField) return '';
    const locationQuery = `${hoveredField.latitude},${hoveredField.longitude}`;
    return `https://maps.google.com/maps?output=embed&t=k&z=12&q=${encodeURIComponent(locationQuery)}`;
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
              zIndex: 2,
              p: 1.25,
              borderColor: 'divider',
              backgroundColor: 'background.paper'
            }}
          >
            <Stack spacing={0.5}>
              <Typography variant="subtitle2">{hoveredField.name}</Typography>
              <Typography variant="body2">
                {hoveredField.crop} | Season {hoveredField.season} |{' '}
                {typeof hoveredField.yield === 'number' && Number.isFinite(hoveredField.yield)
                  ? `${hoveredField.yield.toFixed(1)} bu/ac`
                  : 'Yield N/A'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {hoveredField.county}, {hoveredField.state}
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
            overflowY: 'auto',
            borderColor: 'divider',
            backgroundColor: alpha(theme.palette.background.paper, 0.92),
            backdropFilter: 'blur(2px)'
          }}
        >
          <Stack spacing={1} sx={{ p: 1.5 }}>
            <Typography variant="subtitle2" color="text.secondary">
              Field Locations
            </Typography>
            {isLoading ? (
              <Typography variant="body2" color="text.secondary">
                Loading locations...
              </Typography>
            ) : null}
            {loadError ? (
              <Typography variant="body2" color="error.main">
                {loadError}
              </Typography>
            ) : null}
            {!isLoading && !loadError && fieldsWithColor.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No locations available.
              </Typography>
            ) : null}
            {fieldsWithColor.map((field) => {
              const selected = hoveredField?.id === field.id;
              return (
                <Box
                  key={field.id}
                  onMouseEnter={() => setHoveredField(field)}
                  onClick={() => setHoveredField(field)}
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
                    {field.usedStateFallback ? ' (state fallback)' : ''}
                  </Typography>
                  <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: 'nowrap' }}>
                    <Chip size="small" label={field.crop} />
                    <Chip size="small" variant="outlined" label={`Season ${field.season}`} />
                    <Chip
                      size="small"
                      color="primary"
                      label={
                        typeof field.yield === 'number' && Number.isFinite(field.yield) ? `${field.yield.toFixed(1)} bu/ac` : 'Yield N/A'
                      }
                    />
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
