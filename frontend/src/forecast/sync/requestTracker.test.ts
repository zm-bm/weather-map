import { describe, expect, it } from 'vitest'

import type { ForecastDataTarget } from '@/forecast/data'
import type { ForecastRenderHost } from '@/forecast/render'
import { createRequestTracker } from './requestTracker'

const target = {} as ForecastDataTarget
const renderHost: ForecastRenderHost = {
  version: 1,
  apply: () => undefined,
}

describe('createRequestTracker', () => {
  it('resets active and applied request state when disabled', () => {
    const requestTracker = createRequestTracker()
    const request = requestTracker.start('current')
    requestTracker.markApplied(request)

    expect(requestTracker.prepare({
      isBlocked: false,
      renderHost,
      target: null,
    })).toEqual({ kind: 'disabled' })

    expect(request.controller.signal.aborted).toBe(true)
    expect(requestTracker.isApplied('current')).toBe(false)
    expect(requestTracker.isActive('current')).toBe(false)
  })

  it('aborts active requests while blocked or waiting for a render host', () => {
    const requestTracker = createRequestTracker()
    const blockedRequest = requestTracker.start('blocked')

    expect(requestTracker.prepare({
      isBlocked: true,
      renderHost,
      target,
    })).toEqual({ kind: 'blocked' })
    expect(blockedRequest.controller.signal.aborted).toBe(true)

    const pendingRequest = requestTracker.start('pending')
    expect(requestTracker.prepare({
      isBlocked: false,
      renderHost: null,
      target,
    })).toEqual({ kind: 'pending' })
    expect(pendingRequest.controller.signal.aborted).toBe(true)
  })

  it('returns run decisions only when target and render host are available', () => {
    const requestTracker = createRequestTracker()

    expect(requestTracker.prepare({
      isBlocked: false,
      renderHost,
      target,
    })).toEqual({ kind: 'run', renderHost, target })
  })

  it('tracks active requests, stale requests, and finish behavior', () => {
    const requestTracker = createRequestTracker()
    const firstRequest = requestTracker.start('first')
    const secondRequest = requestTracker.start('second')

    expect(firstRequest.controller.signal.aborted).toBe(true)
    expect(requestTracker.isCurrent(firstRequest)).toBe(false)
    expect(requestTracker.isCurrent(secondRequest)).toBe(true)
    expect(requestTracker.isActive('second')).toBe(true)

    requestTracker.finish(firstRequest)
    expect(requestTracker.isActive('second')).toBe(true)

    requestTracker.finish(secondRequest)
    expect(requestTracker.isActive('second')).toBe(false)
  })

  it('only marks the current request as applied', () => {
    const requestTracker = createRequestTracker()
    const firstRequest = requestTracker.start('first')
    const secondRequest = requestTracker.start('second')

    requestTracker.markApplied(firstRequest)
    expect(requestTracker.isApplied('first')).toBe(false)

    requestTracker.markApplied(secondRequest)
    expect(requestTracker.isApplied('second')).toBe(true)
  })
})
