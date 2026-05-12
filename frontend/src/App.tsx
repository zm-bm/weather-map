import './styles/index.css'

import { useEffect, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

import AppStatusHost from './components/AppStatusHost'
import ForecastShell from './components/ForecastShell/ForecastShell'
import HealthPage from './health/HealthPage'
import { useManifest } from './manifest/useManifest'
import { AppStatusProvider, useAppStatusActions } from './app-status'
import {
  DEFAULT_FORECAST_MODEL_ID,
  FORECAST_MODEL_OPTIONS,
  getForecastModelLabel,
} from './forecast-models'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/health/*" element={<HealthPage />} />
        <Route path="*" element={<ForecastApp />} />
      </Routes>
    </BrowserRouter>
  )
}

function ForecastApp() {
  return (
    <AppStatusProvider>
      <AppContent />
    </AppStatusProvider>
  )
}

function AppContent() {
  const [activeModelId, setActiveModelId] = useState(DEFAULT_FORECAST_MODEL_ID)
  const { manifest, loading, error, retry } = useManifest(activeModelId)
  const { setStatus, clearStatus } = useAppStatusActions()
  const activeModelLabel = getForecastModelLabel(activeModelId)

  useEffect(() => {
    if (manifest) {
      clearStatus('manifest')
      return
    }

    if (loading) {
      setStatus('manifest', {
        mode: 'blocking',
        level: 'loading',
        title: 'Loading Forecast',
        detail: `Fetching latest ${activeModelLabel} forecast cycle manifest.`,
      })
      return
    }

    if (error) {
      setStatus('manifest', {
        mode: 'blocking',
        level: 'error',
        title: 'Forecast Load Failed',
        detail: error.message || 'Unknown startup error.',
        actionLabel: 'Retry',
        onAction: retry,
      })
      return
    }

    setStatus('manifest', {
      mode: 'blocking',
      level: 'loading',
      title: 'Loading Forecast',
      detail: `Waiting for ${activeModelLabel} forecast manifest.`,
    })
  }, [activeModelLabel, clearStatus, error, loading, manifest, retry, setStatus])

  return (
    <div className="app-root">
      <ForecastShell
        manifest={manifest}
        activeModelId={activeModelId}
        modelOptions={FORECAST_MODEL_OPTIONS}
        onActiveModelChange={setActiveModelId}
      />
      <AppStatusHost />
    </div>
  )
}

export default App
