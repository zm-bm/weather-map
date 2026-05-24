import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'

vi.mock('./ForecastApp', () => ({
  default: () => <div data-testid="forecast-route" />,
}))

vi.mock('./health/HealthPage', () => ({
  default: () => <div data-testid="health-route" />,
}))

describe('App routing', () => {
  beforeEach(() => {
    window.history.pushState(null, '', '/')
  })

  it('renders the forecast app for the root route', () => {
    render(<App />)

    expect(screen.getByTestId('forecast-route')).toBeInTheDocument()
    expect(screen.queryByTestId('health-route')).not.toBeInTheDocument()
  })
})
