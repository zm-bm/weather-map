import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import App from './App'

vi.mock('./ForecastApp', () => ({
  default: () => <div data-testid="forecast-route" />,
}))

describe('App', () => {
  it('renders the forecast app', () => {
    render(<App />)

    expect(screen.getByTestId('forecast-route')).toBeInTheDocument()
  })
})
