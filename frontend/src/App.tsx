import { useEffect } from 'react'
import maplibregl, { type StyleSpecification } from 'maplibre-gl'
import './App.css'

function App() {
  useEffect(() => {
    const map = new maplibregl.Map({
      container: 'map',
      center: [-98.5795, 39.8283], // [lng, lat] of usa
      zoom: 5,
      maxZoom: 9,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    })

    map.on('load', () => {
      type PaintValue = Parameters<maplibregl.Map['setPaintProperty']>[2]
      const safeSetPaintProperty = (layerId: string, name: string, value: PaintValue) => {
        try {
          map.setPaintProperty(layerId, name, value)
        } catch {
          // ignore: not all layers support all paint properties
        }
      }

      const safeSetVisibility = (layerId: string, visibility: 'visible' | 'none') => {
        try {
          map.setLayoutProperty(layerId, 'visibility', visibility)
        } catch {
          // ignore
        }
      }

      // Add raster overlay as the very first layer (beneath all basemap layers).
      const beforeId = map.getStyle().layers?.[0]?.id

      map.addSource('weather_overlay', {
        type: 'raster',
        tiles: [`${import.meta.env.VITE_TILES_URL}/tiles/2026010300/temp2m/000/{z}/{x}/{y}.png`],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 5,
      })

      map.addLayer(
        {
          id: 'weather_overlay_layer',
          type: 'raster',
          source: 'weather_overlay',
          paint: { 'raster-opacity': 1 },
        },
        beforeId,
      )

      const lineOpacity = 0.7
      const labelOpacity = 1

      const layers = map.getStyle().layers

      for (const layer of layers ?? []) {
        if (layer.id === 'weather_overlay_layer') continue

        switch (layer.type) {
          case 'fill':
          case 'fill-extrusion':
          case 'heatmap':
          case 'hillshade':
            safeSetVisibility(layer.id, 'none')
            break
          case 'line':
            safeSetVisibility(layer.id, 'visible')
            safeSetPaintProperty(layer.id, 'line-opacity', lineOpacity)
            break
          case 'symbol':
            safeSetVisibility(layer.id, 'visible')
            safeSetPaintProperty(layer.id, 'text-opacity', labelOpacity)
            safeSetPaintProperty(layer.id, 'icon-opacity', 0.9)

            safeSetPaintProperty(layer.id, 'text-color', '#ffffff')
            safeSetPaintProperty(layer.id, 'text-halo-color', 'rgba(0,0,0,0.85)')
            safeSetPaintProperty(layer.id, 'text-halo-width', 1.5)
            safeSetPaintProperty(layer.id, 'text-halo-blur', 0.5)
            break
          case 'circle':
          default:
            safeSetVisibility(layer.id, 'none')
            break
        }
      }
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
