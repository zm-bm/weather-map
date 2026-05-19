import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TransportControls from './TransportControls'

const mocks = vi.hoisted(() => ({
  createTimes: (hours: string[]) => hours.map((id) => ({
    id,
    validAt: new Date(Date.UTC(2026, 3, 9, Number.parseInt(id, 10))).toISOString(),
  })),
  times: [] as Array<{ id: string, validAt: string }>,
  isPlaying: false,
  requestNext: vi.fn(),
  requestPrev: vi.fn(),
  togglePlay: vi.fn(),
}))

vi.mock('../../forecast-time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../forecast-time')>()
  return {
    ...actual,
    useForecastTimeContext: () => ({
      times: mocks.times,
      state: {
        appliedTimeMs: Date.UTC(2026, 3, 9, 0, 0),
        targetTimeMs: Date.UTC(2026, 3, 9, 0, 0),
        pendingTimeMs: null,
        isInFlight: false,
        isPlaying: mocks.isPlaying,
      },
      controls: {
        requestTime: vi.fn(),
        requestNext: mocks.requestNext,
        requestPrev: mocks.requestPrev,
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
    mocks.times = mocks.createTimes(['000', '003', '006'])
    mocks.isPlaying = false
  })

  it('renders enabled step controls and toggles transport actions from buttons', () => {
    render(<TransportControls />)

    const back = screen.getByRole('button', { name: 'Step back ten minutes' })
    const forward = screen.getByRole('button', { name: 'Step forward ten minutes' })
    expect(back).toBeEnabled()
    expect(forward).toBeEnabled()

    const play = screen.getByRole('button', { name: 'Play forecast timeline' })
    expect(play).toBeEnabled()
    fireEvent.click(back)
    fireEvent.click(play)
    fireEvent.click(forward)

    expect(mocks.requestPrev).toHaveBeenCalledOnce()
    expect(mocks.togglePlay).toHaveBeenCalledOnce()
    expect(mocks.requestNext).toHaveBeenCalledOnce()
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
    fireEvent.pointerDown(input)
    fireEvent.keyDown(input, { key: ' ', code: 'Space' })

    expect(mocks.togglePlay).not.toHaveBeenCalled()
  })

  it('toggles playback after a pointer-used step button keeps focus', () => {
    render(<TransportControls />)

    const forward = screen.getByRole('button', { name: 'Step forward ten minutes' })
    fireEvent.pointerDown(forward)
    forward.focus()
    fireEvent.click(forward)
    expect(mocks.requestNext).toHaveBeenCalledOnce()

    fireEvent.keyDown(forward, { key: ' ', code: 'Space' })

    expect(mocks.requestNext).toHaveBeenCalledOnce()
    expect(mocks.togglePlay).toHaveBeenCalledOnce()
  })

  it('keeps Space native for a keyboard-focused step button', () => {
    render(<TransportControls />)

    const forward = screen.getByRole('button', { name: 'Step forward ten minutes' })
    forward.focus()
    fireEvent.keyDown(forward, { key: ' ', code: 'Space' })

    expect(mocks.requestNext).not.toHaveBeenCalled()
    expect(mocks.togglePlay).not.toHaveBeenCalled()
  })

  it('toggles playback after a committed select change blurs the control', () => {
    render(
      <>
        <select
          aria-label="Layer"
          defaultValue="temperature"
          onChange={(event) => event.currentTarget.blur()}
        >
          <option value="temperature">Temperature</option>
          <option value="wind_speed">Wind Speed</option>
        </select>
        <TransportControls />
      </>
    )

    const layer = screen.getByLabelText('Layer') as HTMLSelectElement
    layer.focus()
    fireEvent.keyDown(layer, { key: ' ', code: 'Space' })
    expect(mocks.togglePlay).not.toHaveBeenCalled()

    fireEvent.change(layer, { target: { value: 'wind_speed' } })
    expect(layer).not.toHaveFocus()

    fireEvent.keyDown(document, { key: ' ', code: 'Space' })
    expect(mocks.togglePlay).toHaveBeenCalledOnce()
  })

  it('toggles playback when a pointer-used select keeps focus without a value change', () => {
    render(
      <>
        <select aria-label="Layer" defaultValue="temperature">
          <option value="temperature">Temperature</option>
          <option value="wind_speed">Wind Speed</option>
        </select>
        <TransportControls />
      </>
    )

    const layer = screen.getByLabelText('Layer')
    layer.focus()
    fireEvent.pointerDown(layer)
    fireEvent.keyDown(layer, { key: ' ', code: 'Space' })

    expect(mocks.togglePlay).toHaveBeenCalledOnce()
  })

  it('clears pointer-used shortcut handling when a control loses focus', () => {
    render(
      <>
        <select aria-label="Layer" defaultValue="temperature">
          <option value="temperature">Temperature</option>
          <option value="wind_speed">Wind Speed</option>
        </select>
        <button type="button">Outside</button>
        <TransportControls />
      </>
    )

    const layer = screen.getByLabelText('Layer')
    fireEvent.pointerDown(layer)
    fireEvent.keyDown(layer, { key: ' ', code: 'Space' })
    expect(mocks.togglePlay).toHaveBeenCalledOnce()

    fireEvent.focusOut(layer)
    vi.clearAllMocks()

    fireEvent.keyDown(layer, { key: ' ', code: 'Space' })
    expect(mocks.togglePlay).not.toHaveBeenCalled()
  })

  it('renders pause state and disables playback when timeline has one frame', () => {
    mocks.isPlaying = true
    mocks.times = mocks.createTimes(['000'])

    render(<TransportControls />)

    expect(screen.getByRole('button', { name: 'Step back ten minutes' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Pause playback' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Step forward ten minutes' })).toBeDisabled()

    fireEvent.keyDown(document, { key: ' ', code: 'Space' })
    expect(mocks.togglePlay).not.toHaveBeenCalled()
  })
})
