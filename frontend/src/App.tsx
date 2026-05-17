import './styles/index.css'

import { useEffect, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

import AppStatusHost from './components/AppStatusHost'
import ForecastShell from './components/ForecastShell/ForecastShell'
import HealthPage from './health/HealthPage'
import { useManifest } from './manifest/useManifest'
import { AppStatusProvider, useAppStatusActions } from './app-status'
import {
  type ForecastModelId,
  manifestPathForModel,
  modelOptionsFromAvailabilityIndex,
  useAvailabilityIndex,
} from './forecast-availability'

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
  const [selectedModelId, setSelectedModelId] = useState<ForecastModelId | null>(null)
  const {
    availabilityIndex,
    loading: availabilityLoading,
    error: availabilityError,
    retry: retryAvailability,
  } = useAvailabilityIndex()
  const modelOptions = modelOptionsFromAvailabilityIndex(availabilityIndex)
  const firstModelId = modelOptions[0]?.id ?? null
  const activeModelId = availabilityIndex == null
    ? null
    : selectedModelId != null && availabilityIndex.models[selectedModelId]
      ? selectedModelId
      : firstModelId
  const manifestPath = manifestPathForModel(availabilityIndex, activeModelId)
  const manifestEnabled = availabilityIndex != null && modelOptions.length > 0 && manifestPath != null
  const { manifest, loading, error, retry } = useManifest(manifestPath ?? null, {
    enabled: manifestEnabled,
  })
  const { setStatus, clearStatus } = useAppStatusActions()
  const activeModelLabel = modelOptions.find((model) => model.id === activeModelId)?.label ?? 'forecast'

  useEffect(() => {
    if (availabilityLoading) {
      setStatus('manifest', {
        mode: 'blocking',
        level: 'loading',
        title: 'Loading Forecast',
        detail: 'Fetching forecast layer availability.',
      })
      return
    }

    if (availabilityError) {
      setStatus('manifest', {
        mode: 'blocking',
        level: 'error',
        title: 'Forecast Load Failed',
        detail: availabilityError.message || 'Unable to load forecast availability.',
        actionLabel: 'Retry',
        onAction: retryAvailability,
      })
      return
    }

    if (availabilityIndex && modelOptions.length === 0) {
      setStatus('manifest', {
        mode: 'blocking',
        level: 'error',
        title: 'Forecast Load Failed',
        detail: 'Forecast availability did not list any models.',
        actionLabel: 'Retry',
        onAction: retryAvailability,
      })
      return
    }

    if (availabilityIndex && !manifestPath) {
      setStatus('manifest', {
        mode: 'blocking',
        level: 'error',
        title: 'Forecast Load Failed',
        detail: `No latest ${activeModelLabel} manifest is listed in forecast availability.`,
        actionLabel: 'Retry',
        onAction: retryAvailability,
      })
      return
    }

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
  }, [
    activeModelLabel,
    availabilityError,
    availabilityIndex,
    availabilityLoading,
    clearStatus,
    error,
    loading,
    manifest,
    manifestPath,
    modelOptions.length,
    retry,
    retryAvailability,
    setStatus,
  ])

  return (
    <div className="app-root">
      <ForecastShell
        manifest={manifest}
        availabilityIndex={availabilityIndex}
        activeModelId={activeModelId}
        modelOptions={modelOptions}
        onActiveModelChange={setSelectedModelId}
      />
      <AppStatusHost />
    </div>
  )
}

export default App
