import { useEffect } from 'react'
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl'
import './App.css'

function App() {
  useEffect(() => {
    const tilesUrl = import.meta.env.VITE_TILES_URL ?? 'http://localhost:8081'
    const basemapStyleUrl = `${tilesUrl}/styles/osm-bright/style.json`

    const layer = '2026010300/temp2m/000'
    const weatherTilesUrl = `${import.meta.env.VITE_SERVER_URL}/tiles/${layer}/{z}/{x}/{y}.png`

    const map = new maplibregl.Map({
      container: 'map',
      center: [-112.5795, 38.8283],
      zoom: 5,
      maxZoom: 9,
      style: basemapStyleUrl,
    })

    function applyLabelLanguage(map: MapLibreMap, locale?: string) {
      const lang = (locale ?? navigator.language ?? 'en').split('-')[0]

      const labelLayerIds = [
        'place-city',
        'place-country',
      ]

      for (const id of labelLayerIds) {
        if (!map.getLayer(id)) continue

        map.setLayoutProperty(id, 'text-field', [
          'coalesce',
          ['get', `name:${lang}`],
          ['get', 'name:latin'],
          ['get', 'name'],
        ])
      }
    }

    let hoveredId = null;

    map.on('mousemove', 'place-city', (e) => {
      map.getCanvas().style.cursor = e.features.length ? 'pointer' : '';
      const f = e.features?.[0];
      if (!f) return;

      const id = f.id ?? f.properties?.id; // ideally f.id exists
      if (id == null) return;

      if (hoveredId !== null && hoveredId !== id) {
        map.setFeatureState({ source: 'openmaptiles', sourceLayer: 'place', id: hoveredId }, { hover: false });
      }
      hoveredId = id;
      map.setFeatureState({ source: 'openmaptiles', sourceLayer: 'place', id }, { hover: true });
    });

    map.on('mouseleave', 'place-city', () => {
      map.getCanvas().style.cursor = '';
      if (hoveredId !== null) {
        map.setFeatureState({ source: 'openmaptiles', sourceLayer: 'place', id: hoveredId }, { hover: false });
      }
      hoveredId = null;
    });

    map.on('load', () => {
      applyLabelLanguage(map)

      map.addSource('weather_overlay', {
        type: 'raster',
        tiles: [weatherTilesUrl],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 5,
      })

      console.log(map.queryRenderedFeatures({ layers: ["place-city"] }))

      const firstLineId = map.getStyle().layers?.find((l) => l.type === 'line')?.id
      map.addLayer(
        {
          id: 'weather_overlay_layer',
          type: 'raster',
          source: 'weather_overlay',
          paint: { 'raster-opacity': 1 },
        },
        firstLineId,
      )
    })

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    return () => map.remove()
  }, [])

  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      <div id="map" style={{ height: '100%', width: '100%' }} />
    </div>
  )
}

export default App
