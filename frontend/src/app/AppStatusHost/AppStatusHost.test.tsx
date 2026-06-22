import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import AppStatusHost, { type AppStatus } from './AppStatusHost'

function renderHost(status: AppStatus) {
  return render(<AppStatusHost status={status} />)
}

describe('AppStatusHost', () => {
  it('renders loading toast statuses as compact chips', () => {
    renderHost({
      kind: 'loading',
      title: 'Loading Forecast',
    })

    const status = screen.getByText('Loading Forecast')
    expect(status).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading Forecast' }))
      .toHaveAttribute('aria-live', 'polite')
  })

  it('renders and calls an optional status action', () => {
    const onAction = vi.fn()

    renderHost({
      kind: 'error',
      title: 'Forecast Load Failed',
      detail: 'manifest failed',
      hint: 'Retry the forecast catalog.',
      actionLabel: 'Retry',
      onAction,
    })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveAttribute('aria-live', 'assertive')
    expect(screen.getByText('Retry the forecast catalog.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('renders nothing without an active status', () => {
    const { container } = renderHost(null)

    expect(container).toBeEmptyDOMElement()
  })
})
