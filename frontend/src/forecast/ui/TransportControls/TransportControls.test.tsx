import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ForecastTimeContextValue } from '@/forecast/time'
import {
  createForecastTimeContextValue,
  createForecastTimesFixture,
} from '@/test/fixtures'
import TransportControls from './TransportControls'

const mocks = vi.hoisted(() => ({
  timeContext: null as ForecastTimeContextValue | null,
  requestNext: vi.fn(),
  requestPrev: vi.fn(),
  togglePlay: vi.fn(),
}))

vi.mock('@/forecast/time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/forecast/time')>()
  return {
    ...actual,
    useForecastTimeContext: () => mocks.timeContext,
  }
})

function setForecastTimeContext(args: {
  hours?: string[]
  state?: Partial<ForecastTimeContextValue['state']>
} = {}) {
  mocks.timeContext = createForecastTimeContextValue(null, {
    times: createForecastTimesFixture(args.hours ?? ['000', '003', '006'], '2026040900'),
    state: {
      isPlaying: false,
      ...args.state,
    },
    controls: {
      requestNext: mocks.requestNext,
      requestPrev: mocks.requestPrev,
      togglePlay: mocks.togglePlay,
    },
  })
}

function renderTransport(ui: Parameters<typeof render>[0] = <TransportControls />) {
  return render(ui)
}

function pressSpace(target: Document | Element = document, options: Partial<KeyboardEventInit> = {}) {
  fireEvent.keyDown(target, { key: ' ', code: 'Space', ...options })
}

function stepBackButton() {
  return screen.getByRole('button', { name: 'Step back ten minutes' })
}

function stepForwardButton() {
  return screen.getByRole('button', { name: 'Step forward ten minutes' })
}

function playButton() {
  return screen.getByRole('button', { name: 'Play forecast timeline' })
}

function pauseButton() {
  return screen.getByRole('button', { name: 'Pause playback' })
}

function layerSelect(): HTMLSelectElement {
  return screen.getByLabelText('Layer') as HTMLSelectElement
}

function renderWithLayerSelect(options: { blurOnChange?: boolean, outsideButton?: boolean } = {}) {
  return renderTransport(
    <>
      <select
        aria-label="Layer"
        defaultValue="temperature"
        onChange={options.blurOnChange ? (event) => event.currentTarget.blur() : undefined}
      >
        <option value="temperature">Temperature</option>
        <option value="wind_speed">Wind Speed</option>
      </select>
      {options.outsideButton ? <button type="button">Outside</button> : null}
      <TransportControls />
    </>
  )
}

describe('TransportControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setForecastTimeContext()
  })

  it('renders enabled step controls and toggles transport actions from buttons', () => {
    renderTransport()

    const back = stepBackButton()
    const forward = stepForwardButton()
    expect(back).toBeEnabled()
    expect(forward).toBeEnabled()

    const play = playButton()
    expect(play).toBeEnabled()
    fireEvent.click(back)
    fireEvent.click(play)
    fireEvent.click(forward)

    expect(mocks.requestPrev).toHaveBeenCalledOnce()
    expect(mocks.togglePlay).toHaveBeenCalledOnce()
    expect(mocks.requestNext).toHaveBeenCalledOnce()
  })

  it('toggles playback from the global space shortcut', () => {
    renderTransport()

    pressSpace()

    expect(mocks.togglePlay).toHaveBeenCalledOnce()
  })

  it('ignores repeated space shortcut events', () => {
    renderTransport()

    pressSpace(document, { repeat: true })

    expect(mocks.togglePlay).not.toHaveBeenCalled()
  })

  it('ignores the space shortcut while an interactive control has focus', () => {
    renderTransport(
      <>
        <input aria-label="Location search" />
        <TransportControls />
      </>
    )

    const input = screen.getByRole('textbox', { name: 'Location search' })
    input.focus()
    fireEvent.pointerDown(input)
    pressSpace(input)

    expect(mocks.togglePlay).not.toHaveBeenCalled()
  })

  it('toggles playback after a pointer-used step button keeps focus', () => {
    renderTransport()

    const forward = stepForwardButton()
    fireEvent.pointerDown(forward)
    forward.focus()
    fireEvent.click(forward)
    expect(mocks.requestNext).toHaveBeenCalledOnce()

    pressSpace(forward)

    expect(mocks.requestNext).toHaveBeenCalledOnce()
    expect(mocks.togglePlay).toHaveBeenCalledOnce()
  })

  it('keeps Space native for a keyboard-focused step button', () => {
    renderTransport()

    const forward = stepForwardButton()
    forward.focus()
    pressSpace(forward)

    expect(mocks.requestNext).not.toHaveBeenCalled()
    expect(mocks.togglePlay).not.toHaveBeenCalled()
  })

  it('toggles playback after a committed select change blurs the control', () => {
    renderWithLayerSelect({ blurOnChange: true })

    const layer = layerSelect()
    layer.focus()
    pressSpace(layer)
    expect(mocks.togglePlay).not.toHaveBeenCalled()

    fireEvent.change(layer, { target: { value: 'wind_speed' } })
    expect(layer).not.toHaveFocus()

    pressSpace()
    expect(mocks.togglePlay).toHaveBeenCalledOnce()
  })

  it('toggles playback when a pointer-used select keeps focus without a value change', () => {
    renderWithLayerSelect()

    const layer = layerSelect()
    layer.focus()
    fireEvent.pointerDown(layer)
    pressSpace(layer)

    expect(mocks.togglePlay).toHaveBeenCalledOnce()
  })

  it('clears pointer-used shortcut handling when a control loses focus', () => {
    renderWithLayerSelect({ outsideButton: true })

    const layer = layerSelect()
    fireEvent.pointerDown(layer)
    pressSpace(layer)
    expect(mocks.togglePlay).toHaveBeenCalledOnce()

    fireEvent.focusOut(layer)
    vi.clearAllMocks()

    pressSpace(layer)
    expect(mocks.togglePlay).not.toHaveBeenCalled()
  })

  it('renders pause state and disables playback when timeline has one frame', () => {
    setForecastTimeContext({
      hours: ['000'],
      state: { isPlaying: true },
    })

    renderTransport()

    expect(stepBackButton()).toBeDisabled()
    expect(pauseButton()).toBeDisabled()
    expect(stepForwardButton()).toBeDisabled()

    pressSpace()
    expect(mocks.togglePlay).not.toHaveBeenCalled()
  })
})
