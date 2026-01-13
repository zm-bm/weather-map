import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl'
import './App.css'

const LABEL_LAYER_IDS = ['place-city', 'place-country']

function applyLabelLanguage(map: MapLibreMap, locale?: string) {
  const lang = (locale ?? navigator.language ?? 'en').split('-')[0]

  for (const id of LABEL_LAYER_IDS) {
    if (!map.getLayer(id)) continue

    map.setLayoutProperty(id, 'text-field', [
      'coalesce',
      ['get', `name:${lang}`],
      ['get', 'name:latin'],
      ['get', 'name'],
    ])
  }
}

function useMap(basemapStyleUrl: string) {
  const mapRef = useRef<MapLibreMap | null>(null)

  useEffect(() => {
    const map = new maplibregl.Map({
      container: 'map',
      center: [-112.5795, 38.8283],
      zoom: 5,
      maxZoom: 9,
      style: basemapStyleUrl,
    })

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [basemapStyleUrl])

  return mapRef
}

function useLabelLanguage(mapRef: RefObject<MapLibreMap | null>) {
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const onLoad = () => applyLabelLanguage(map)
    map.on('load', onLoad)

    return () => {
      map.off('load', onLoad)
    }
  }, [mapRef])
}

function usePlaceHover(mapRef: RefObject<MapLibreMap | null>) {
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    let hoveredId: number | string | null = null

    const onMove = (e: maplibregl.MapMouseEvent & maplibregl.MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = e.features?.length ? 'pointer' : ''
      const feature = e.features?.[0]
      if (!feature) return

      const id = feature.id ?? feature.properties?.id
      if (id == null) return

      if (hoveredId !== null && hoveredId !== id) {
        map.setFeatureState(
          { source: 'openmaptiles', sourceLayer: 'place', id: hoveredId },
          { hover: false },
        )
      }
      hoveredId = id
      map.setFeatureState({ source: 'openmaptiles', sourceLayer: 'place', id }, { hover: true })
    }

    const onLeave = () => {
      map.getCanvas().style.cursor = ''
      if (hoveredId !== null) {
        map.setFeatureState(
          { source: 'openmaptiles', sourceLayer: 'place', id: hoveredId },
          { hover: false },
        )
      }
      hoveredId = null
    }

    const attach = () => {
      if (!map.getLayer('place-city')) return
      map.on('mousemove', 'place-city', onMove)
      map.on('mouseleave', 'place-city', onLeave)
    }

    const detach = () => {
      if (!map.getLayer('place-city')) return
      map.off('mousemove', 'place-city', onMove)
      map.off('mouseleave', 'place-city', onLeave)
    }

    map.on('load', attach)

    return () => {
      map.off('load', attach)
      detach()
    }
  }, [mapRef])
}

function useWeatherOverlay(
  mapRef: RefObject<MapLibreMap | null>,
  weatherTilesUrl: string,
) {
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const onLoad = () => {
      if (!map.getSource('weather_overlay')) {
        map.addSource('weather_overlay', {
          type: 'raster',
          tiles: [weatherTilesUrl],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 5,
        })
      }

      const firstLineId = map.getStyle().layers?.find((l) => l.type === 'line')?.id
      if (!map.getLayer('weather_overlay_layer')) {
        map.addLayer(
          {
            id: 'weather_overlay_layer',
            type: 'raster',
            source: 'weather_overlay',
            paint: { 'raster-opacity': 1 },
          },
          firstLineId,
        )
      }
    }

    map.on('load', onLoad)

    return () => {
      map.off('load', onLoad)
    }
  }, [mapRef, weatherTilesUrl])
}

function App() {
  const tilesUrl = import.meta.env.VITE_TILES_URL ?? 'http://localhost:8081'
  const basemapStyleUrl = `${tilesUrl}/styles/osm-bright/style.json`

  const layer = '2026010300/temp2m/000'
  const weatherTilesUrl = `${import.meta.env.VITE_SERVER_URL}/tiles/${layer}/{z}/{x}/{y}.png`

  const mapRef = useMap(basemapStyleUrl)

  useLabelLanguage(mapRef)
  usePlaceHover(mapRef)
  useWeatherOverlay(mapRef, weatherTilesUrl)

  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      <div id="map" style={{ height: '100%', width: '100%' }} />
    </div>
  )
}

export default App
