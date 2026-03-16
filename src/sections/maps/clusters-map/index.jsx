import PropTypes from 'prop-types';
import { useRef, memo } from 'react';

import { Map, Layer, Source } from 'react-map-gl/mapbox';

// project imports
import { clusterCountLayer, clusterLayer, unclusteredPointLayer } from './layers';

// ==============================|| MAP - CLUSTERS ||============================== //

function MapClusters({ ...other }) {
  const mapRef = useRef(null);

  const onClick = (event) => {
    const feature = event.features?.[0];
    const clusterId = feature?.properties?.cluster_id;

    const mapboxSource = mapRef.current?.getSource('earthquakes');

    if (clusterId) {
      mapboxSource.getClusterExpansionZoom(clusterId, (error, zoom) => {
        if (error || zoom === null || zoom === undefined) {
          return;
        }

        if (feature?.geometry.type === 'Point') {
          mapRef.current?.easeTo({
            center: feature?.geometry.coordinates,
            zoom: Number.isNaN(zoom) ? 3 : zoom,
            duration: 500
          });
        }
      });
    }
  };

  return (
    <Map
      initialViewState={{
        latitude: 40.67,
        longitude: -103.59,
        zoom: 3
      }}
      interactiveLayerIds={[clusterLayer.id || '']}
      onClick={onClick}
      ref={mapRef}
      {...other}
      logoPosition="top-left"
    >
      <Source
        id="earthquakes"
        type="geojson"
        data="https://docs.mapbox.com/mapbox-gl-js/assets/earthquakes.geojson"
        cluster
        clusterMaxZoom={14}
        clusterRadius={50}
      >
        <Layer {...clusterLayer} />
        <Layer {...clusterCountLayer} />
        <Layer {...unclusteredPointLayer} />
      </Source>
    </Map>
  );
}

export default memo(MapClusters);

MapClusters.propTypes = { other: PropTypes.any };
