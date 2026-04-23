import './styles/index.css'

import { useEffect } from 'react'

import AppStatusHost from './components/AppStatusHost'
import ForecastShell from './components/ForecastShell/ForecastShell'
import { useManifest } from './manifest/useManifest'
import { useAppStatusActions } from './app-status/AppStatusContext'
import AppStatusProvider from './app-status/AppStatusProvider'

function App() {
  return (
    <AppStatusProvider>
      <AppContent />
    </AppStatusProvider>
  )
}

function AppContent() {
  const { manifest, loading, error, retry } = useManifest()
  const { setStatus, clearStatus } = useAppStatusActions()

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
        detail: 'Fetching latest forecast cycle manifest.',
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
      detail: 'Waiting for forecast manifest.',
    })
  }, [clearStatus, error, loading, manifest, retry, setStatus])

  return (
    <div className="app-root">
      <ForecastShell manifest={manifest} />
      <AppStatusHost />
    </div>
  )
}

export default App
