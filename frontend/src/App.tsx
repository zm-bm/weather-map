import { useEffect, useMemo, useState } from 'react'
import './App.css'

import config from './config'
import { useCycleManifest } from './hooks/useCycleManifest'
import LayerControls from './components/LayerControls'
import MapContainer from './components/MapContainer'


function App() {
  const [activeLayer, setActiveLayer] = useState<string>(config.defaultLayer)
  const [activeHour, setActiveHour] = useState<string>(config.defaultHour)
  const [isPlaying, setIsPlaying] = useState(false)

  const PLAY_INTERVAL_SECONDS = 1

  const { manifest } = useCycleManifest()

  const layers = useMemo(() => manifest?.layers ?? [], [manifest])
  const forecastHours = useMemo(() => manifest?.forecast_hours ?? [], [manifest])

  const displayLayer = layers.includes(activeLayer) ? activeLayer : (layers[0] ?? activeLayer)
  const displayHour = forecastHours.includes(activeHour) ? activeHour : (forecastHours[0] ?? activeHour)

  useEffect(() => {
    if (!isPlaying) return
    if (forecastHours.length <= 1) return

    const id = window.setInterval(() => {
      const idx = forecastHours.indexOf(displayHour)
      const next = forecastHours[(idx + 1) % forecastHours.length] ?? displayHour
      setActiveHour(next)
    }, PLAY_INTERVAL_SECONDS * 1000)

    return () => window.clearInterval(id)
  }, [isPlaying, forecastHours, displayHour])

  return (
    <div style={{ height: '100vh', width: '100vw', position: 'relative' }}>
      {forecastHours.length > 0 && layers.length > 0 && (
        <LayerControls
          layers={layers}
          forecastHours={forecastHours}
          activeLayer={displayLayer}
          activeHour={displayHour}
          onLayerChange={setActiveLayer}
          onHourChange={setActiveHour}
          onPrevHour={() => {
            const idx = forecastHours.indexOf(displayHour)
            const prev = forecastHours[(idx - 1 + forecastHours.length) % forecastHours.length] ?? displayHour
            setActiveHour(prev)
          }}
          onNextHour={() => {
            const idx = forecastHours.indexOf(displayHour)
            const next = forecastHours[(idx + 1) % forecastHours.length] ?? displayHour
            setActiveHour(next)
          }}
          isPlaying={isPlaying}
          onTogglePlay={() => setIsPlaying((p) => !p)}
          playIntervalSeconds={PLAY_INTERVAL_SECONDS}
        />
      )}

      <MapContainer manifest={manifest} activeLayer={displayLayer} activeHour={displayHour} />
    </div>
  )
}

export default App
