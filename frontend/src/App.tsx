import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
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

    map.on('load', () => {
      // Insert the weather overlay ABOVE basemap fills/lines but BELOW labels.
      const firstSymbolId = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id

      map.addSource('weather_overlay', {
        type: 'raster',
        tiles: [weatherTilesUrl],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 5,
      })

      map.addLayer(
        {
          id: 'weather_overlay_layer',
          type: 'raster',
          source: 'weather_overlay',
          paint: { 'raster-opacity': 0.95 },
        },
        firstSymbolId,
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
