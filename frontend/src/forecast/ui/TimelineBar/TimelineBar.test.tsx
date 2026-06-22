import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ForecastTimeContextValue } from '@/forecast/time'
import {
  createForecastTimeContextValue,
  createForecastTimesFixture,
} from '@/test/fixtures'
import TimelineBar from './TimelineBar'

const mocks = vi.hoisted(() => ({
  timeContext: null as ForecastTimeContextValue | null,
  requestTime: vi.fn(),
  resetToNow: vi.fn(),
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
      requestTime: mocks.requestTime,
      resetToNow: mocks.resetToNow,
      togglePlay: mocks.togglePlay,
    },
  })
}

describe('TimelineBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setForecastTimeContext()
  })

  it('renders integrated playback, ruler, and reset controls', () => {
    render(<TimelineBar />)

    const timelineBar = screen.getByLabelText('Forecast timeline controls')
    const play = within(timelineBar).getByRole('button', { name: 'Play forecast timeline' })
    const reset = within(timelineBar).getByRole('button', { name: 'Reset timeline to now' })

    expect(within(timelineBar).getByRole('slider', { name: 'Forecast time' })).toBeInTheDocument()
    expect(play).toBeEnabled()
    expect(reset).toBeEnabled()

    fireEvent.click(play)
    fireEvent.click(reset)

    expect(mocks.togglePlay).toHaveBeenCalledOnce()
    expect(mocks.resetToNow).toHaveBeenCalledOnce()
  })

  it('renders pause state and disables controls when timeline has one frame', () => {
    setForecastTimeContext({
      hours: ['000'],
      state: { isPlaying: true },
    })

    render(<TimelineBar />)

    expect(screen.getByRole('button', { name: 'Pause playback' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset timeline to now' })).toBeDisabled()
    expect(screen.getByRole('slider', { name: 'Forecast time' })).toHaveAttribute('aria-disabled', 'true')
  })
})
