import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import AppStatusHost from './AppStatusHost'
import type { AppStatus } from './types'

function renderHost(status: AppStatus) {
  return render(<AppStatusHost status={status} />)
}

describe('AppStatusHost', () => {
  it('renders blocking statuses in overlay wrapper', () => {
    renderHost({
      mode: 'blocking',
      level: 'loading',
      title: 'Loading Forecast',
      detail: 'Fetching manifest...',
    })

    const status = screen.getByText('Loading Forecast')
    expect(status).toBeInTheDocument()
    expect(status.closest('.forecast-screen__status-overlay')).not.toBeNull()
  })

  it('renders toast statuses in toast wrapper', () => {
    renderHost({
      mode: 'toast',
      level: 'info',
      title: 'Heads up',
      detail: 'Map loaded',
    })

    const status = screen.getByText('Heads up')
    expect(status).toBeInTheDocument()
    expect(status.closest('.app-status-toast')).not.toBeNull()
  })

  it('renders and calls an optional status action', () => {
    const onAction = vi.fn()

    renderHost({
      mode: 'blocking',
      level: 'error',
      title: 'Forecast Load Failed',
      detail: 'manifest failed',
      actionLabel: 'Retry',
      onAction,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('renders nothing without an active status', () => {
    const { container } = renderHost(null)

    expect(container).toBeEmptyDOMElement()
  })
})
