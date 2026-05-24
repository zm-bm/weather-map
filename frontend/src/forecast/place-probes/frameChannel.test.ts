import { describe, expect, it, vi } from 'vitest'

import { createFieldWindowFixture } from '@/test/fixtures'
import { createForecastPlaceProbeFrameChannel } from './frameChannel'

describe('createForecastPlaceProbeFrameChannel', () => {
  it('stores the latest frame and notifies subscribers', () => {
    const channel = createForecastPlaceProbeFrameChannel()
    const listener = vi.fn()
    const frame = createFieldWindowFixture()

    const unsubscribe = channel.subscribe(listener)

    channel.publish(frame)

    expect(channel.getSnapshot()).toBe(frame)
    expect(listener).toHaveBeenCalledWith(frame)

    unsubscribe()
    channel.publish(null)

    expect(channel.getSnapshot()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
