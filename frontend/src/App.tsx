import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import './App.css'

function App() {
  useEffect(() => {
    const cartoBaseTiles = [
      'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      'https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    ]

    const cartoLabelTiles = [
      'https://a.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
      'https://b.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
      'https://c.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
      'https://d.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
    ]

    const map = new maplibregl.Map({
      container: 'map',
      center: [-98.5795, 39.8283], // [lng, lat] of usa
      zoom: 5,
      maxZoom: 9,
      style: {
        version: 8,
        sources: {
          carto_base: {
            type: 'raster',
            tiles: cartoBaseTiles,
            tileSize: 256,
            attribution: '&copy; OpenStreetMap &copy; CARTO',
          },
          weather_overlay: {
            type: 'raster',
            tiles: ['http://localhost:8080/tiles/2026010300/temp2m/000/{z}/{x}/{y}.png'],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 5,
          },
          carto_labels: {
            type: 'raster',
            tiles: cartoLabelTiles,
            tileSize: 256,
            attribution: '&copy; OpenStreetMap &copy; CARTO',
          },
        },
        layers: [
          {
            id: 'weather_overlay_layer',
            type: 'raster',
            source: 'weather_overlay',
          },
          {
            id: 'carto_base_layer',
            type: 'raster',
            source: 'carto_base',
            paint: {
              'raster-opacity': 0.4,
            },
          },
          {
            id: 'carto_labels_layer',
            type: 'raster',
            source: 'carto_labels',
          },
        ],
      },
    })

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')

    return () => {
      map.remove()
    }
  }, [])

  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      <div id="map" style={{ height: '100%', width: '100%' }} />
    </div>
  )
}

export default App
