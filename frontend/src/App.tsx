import { useMemo, useState } from 'react'
import './App.css'

import config from './config'
import { useCycleManifest } from './hooks/useCycleManifest'
import LayerControls from './components/LayerControls'
import MapContainer from './components/MapContainer'


function App() {
  const [activeLayer, setActiveLayer] = useState<string>(config.defaultLayer)
  const [activeHour, setActiveHour] = useState<string>(config.defaultHour)

  const { manifest } = useCycleManifest()

  const layers = useMemo(() => manifest?.layers ?? [], [manifest])
  const forecastHours = useMemo(() => manifest?.forecast_hours ?? [], [manifest])

  const displayLayer = layers.includes(activeLayer) ? activeLayer : (layers[0] ?? activeLayer)
  const displayHour = forecastHours.includes(activeHour) ? activeHour : (forecastHours[0] ?? activeHour)

  return (
    <div style={{ height: '100vh', width: '100vw', position: 'relative' }}>
      {forecastHours.length > 0 && layers.length > 0 && (
        <LayerControls
          layers={layers}
          forecastHours={forecastHours}
          activeLayer={displayLayer}
          activeHour={displayHour}
          onLayerChange={setActiveLayer}
          onNextHour={() => {
            const idx = forecastHours.indexOf(displayHour)
            const next = forecastHours[(idx + 1) % forecastHours.length] ?? displayHour
            setActiveHour(next)
          }}
        />
      )}

      <MapContainer manifest={manifest} activeLayer={activeLayer} activeHour={activeHour} />
    </div>
  )
}

export default App
