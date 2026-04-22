import { useEffect } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import AppStatusHost from './AppStatusHost'
import { useAppStatusActions } from '../../app-status/AppStatusContext'
import AppStatusProvider from '../../app-status/AppStatusProvider'

function StatusPublisher(props: {
  sourceId: string
  mode: 'blocking' | 'toast'
  level: 'loading' | 'error' | 'info'
  title: string
  detail: string
}) {
  const { sourceId, mode, level, title, detail } = props
  const { setStatus } = useAppStatusActions()

  useEffect(() => {
    setStatus(sourceId, { mode, level, title, detail })
  }, [detail, level, mode, setStatus, sourceId, title])

  return null
}

describe('AppStatusHost', () => {
  it('renders blocking statuses in overlay wrapper', async () => {
    render(
      <AppStatusProvider>
        <StatusPublisher
          sourceId="manifest"
          mode="blocking"
          level="loading"
          title="Loading Forecast"
          detail="Fetching manifest..."
        />
        <AppStatusHost />
      </AppStatusProvider>
    )

    const status = await screen.findByText('Loading Forecast')
    expect(status).toBeInTheDocument()
    expect(status.closest('.forecast-screen__status-overlay')).not.toBeNull()
  })

  it('renders toast statuses in toast wrapper', async () => {
    render(
      <AppStatusProvider>
        <StatusPublisher
          sourceId="hint"
          mode="toast"
          level="info"
          title="Heads up"
          detail="Map loaded"
        />
        <AppStatusHost />
      </AppStatusProvider>
    )

    const status = await screen.findByText('Heads up')
    expect(status).toBeInTheDocument()
    expect(status.closest('.app-status-toast')).not.toBeNull()
  })
})
