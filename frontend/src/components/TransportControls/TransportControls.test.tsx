import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TransportControls from './TransportControls'

const mocks = vi.hoisted(() => ({
  cycle: '2026040900',
  forecastHours: ['000', '003', '006'],
  isPlaying: false,
  togglePlay: vi.fn(),
}))

vi.mock('../../forecast-time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../forecast-time')>()
  return {
    ...actual,
    useForecastTimeContext: () => ({
      cycle: mocks.cycle,
      forecastHours: mocks.forecastHours,
      state: {
        appliedTimeMs: Date.UTC(2026, 3, 9, 0, 0),
        targetTimeMs: Date.UTC(2026, 3, 9, 0, 0),
        pendingTimeMs: null,
        isInFlight: false,
        isPlaying: mocks.isPlaying,
      },
      controls: {
        requestTime: vi.fn(),
        requestNext: vi.fn(),
        requestPrev: vi.fn(),
        togglePlay: mocks.togglePlay,
      },
      sync: {
        onRequestStart: vi.fn(),
        onRequestApplied: vi.fn(),
        onRequestError: vi.fn(),
      },
    }),
  }
})

describe('TransportControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cycle = '2026040900'
    mocks.forecastHours = ['000', '003', '006']
    mocks.isPlaying = false
  })

  it('renders disabled step controls and toggles playback from the play button', () => {
    render(<TransportControls />)

    expect(screen.getByRole('button', { name: 'Step back one hour' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Step forward one hour' })).toBeDisabled()

    const play = screen.getByRole('button', { name: 'Play forecast timeline' })
    expect(play).toBeEnabled()
    fireEvent.click(play)
    expect(mocks.togglePlay).toHaveBeenCalledOnce()
  })

  it('toggles playback from the global space shortcut', () => {
    render(<TransportControls />)

    fireEvent.keyDown(document, { key: ' ', code: 'Space' })

    expect(mocks.togglePlay).toHaveBeenCalledOnce()
  })

  it('ignores repeated space shortcut events', () => {
    render(<TransportControls />)

    fireEvent.keyDown(document, { key: ' ', code: 'Space', repeat: true })

    expect(mocks.togglePlay).not.toHaveBeenCalled()
  })

  it('ignores the space shortcut while an interactive control has focus', () => {
    render(
      <>
        <input aria-label="Location search" />
        <TransportControls />
      </>
    )

    const input = screen.getByRole('textbox', { name: 'Location search' })
    input.focus()
    fireEvent.keyDown(input, { key: ' ', code: 'Space' })

    expect(mocks.togglePlay).not.toHaveBeenCalled()
  })

  it('renders pause state and disables playback when timeline has one frame', () => {
    mocks.isPlaying = true
    mocks.forecastHours = ['000']

    render(<TransportControls />)

    expect(screen.getByRole('button', { name: 'Pause playback' })).toBeDisabled()

    fireEvent.keyDown(document, { key: ' ', code: 'Space' })
    expect(mocks.togglePlay).not.toHaveBeenCalled()
  })
})
