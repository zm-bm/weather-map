import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import TimelineBar from './TimelineBar'

vi.mock('../TransportControls', () => ({
  default: () => <div data-testid="transport-controls" />,
}))

vi.mock('../TimelineScrubber', () => ({
  default: () => <div data-testid="timeline-scrubber" />,
}))

describe('TimelineBar', () => {
  it('renders transport and timeline zones in order', () => {
    const { container } = render(<TimelineBar />)
    const controlBar = screen.getByLabelText('Forecast timeline controls')
    const grid = container.querySelector('.timeline-bar__grid')

    expect(controlBar).toHaveClass('timeline-bar')
    expect(controlBar.querySelector('.timeline-bar__titlebar')).not.toBeNull()
    expect(grid).not.toBeNull()
    expect(within(controlBar).getByTestId('transport-controls')).toBeInTheDocument()
    expect(within(controlBar).getByTestId('timeline-scrubber')).toBeInTheDocument()
    expect(within(controlBar).queryByTestId('forecast-controls')).not.toBeInTheDocument()
    expect(Array.from(grid?.children ?? []).map((child) => child.getAttribute('data-testid'))).toEqual([
      'transport-controls',
      'timeline-scrubber',
    ])
  })
})
