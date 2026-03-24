import PropTypes from 'prop-types';
import { useState, memo } from 'react';

// material-ui
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';

// third-party
import Map from 'react-map-gl/mapbox';

// project imports
import MapControl from 'components/third-party/map/MapControl';
import MapMarker from 'components/third-party/map/MapMarker';
import MapPopup from 'components/third-party/map/MapPopup';

// ==============================|| MAPBOX - MARKERS AND POPUP ||============================== //

function MarkersPopups({ data, ...other }) {
  const [popupInfo, setPopupInfo] = useState(null);

  return (
    <Map
      initialViewState={{
        latitude: 21.2335611,
        longitude: 72.8636084,
        zoom: 2
      }}
      {...other}
      logoPosition="top-left"
    >
      <MapControl />
      {data.map((city, index) => (
        <MapMarker
          key={`marker-${index}`}
          latitude={city.latlng[0]}
          longitude={city.latlng[1]}
          onClick={(event) => {
            event.originalEvent.stopPropagation();
            setPopupInfo(city);
          }}
        />
      ))}

      {popupInfo && (
        <MapPopup latitude={popupInfo.latlng[0]} longitude={popupInfo.latlng[1]} onClose={() => setPopupInfo(null)}>
          <Stack direction="row" sx={{ mb: 1, alignItems: 'center' }}>
            <Box
              sx={{
                height: 18,
                minWidth: 28,
                mr: 1,
                borderRadius: 2,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
                backgroundImage: `url(https://cdn.staticaly.com/gh/hjnilsson/country-flags/master/svg/${popupInfo.country_code.toLowerCase()}.svg)`
              }}
            />
            <Typography variant="subtitle2">{popupInfo.name}</Typography>
          </Stack>

          <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
            <Typography>Timezones:</Typography>
            <Typography variant="caption">{popupInfo.timezones}</Typography>
          </Stack>

          <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
            <Typography>Lat:</Typography>
            <Typography variant="caption">{popupInfo.latlng[0]}</Typography>
          </Stack>

          <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
            <Typography>Long</Typography>
            <Typography variant="caption">{popupInfo.latlng[1]}</Typography>
          </Stack>
        </MapPopup>
      )}
    </Map>
  );
}

export default memo(MarkersPopups);

MarkersPopups.propTypes = { data: PropTypes.array, other: PropTypes.any };
