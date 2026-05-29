import { describe, expect, it } from 'vitest'

import { createRequestTracker } from './requestTracker'

describe('createRequestTracker', () => {
  it('resets active and applied request state', () => {
    const requestTracker = createRequestTracker()
    const request = beginRun(requestTracker, 'current')
    requestTracker.markApplied(request)

    requestTracker.reset()

    expect(request.controller.signal.aborted).toBe(true)
    expect(requestTracker.begin('current')).not.toBeNull()
  })

  it('aborts active requests without clearing applied request state', () => {
    const requestTracker = createRequestTracker()
    const appliedRequest = beginRun(requestTracker, 'applied')
    requestTracker.markApplied(appliedRequest)
    requestTracker.finish(appliedRequest)
    const activeRequest = beginRun(requestTracker, 'active')

    requestTracker.abortActive()

    expect(activeRequest.controller.signal.aborted).toBe(true)
    expect(requestTracker.begin('applied')).toBeNull()
  })

  it('tracks active requests, stale requests, and finish behavior', () => {
    const requestTracker = createRequestTracker()
    const firstRequest = beginRun(requestTracker, 'first')
    const secondRequest = beginRun(requestTracker, 'second')

    expect(firstRequest.controller.signal.aborted).toBe(true)
    expect(requestTracker.isCurrent(firstRequest)).toBe(false)
    expect(requestTracker.isCurrent(secondRequest)).toBe(true)

    const activeController = new AbortController()
    expect(requestTracker.begin('second', activeController)).toBeNull()
    expect(activeController.signal.aborted).toBe(true)

    requestTracker.finish(firstRequest)
    expect(requestTracker.begin('second')).toBeNull()

    requestTracker.finish(secondRequest)
    expect(requestTracker.begin('second')).not.toBeNull()
  })

  it('only marks the current request as applied', () => {
    const requestTracker = createRequestTracker()
    const firstRequest = beginRun(requestTracker, 'first')
    const secondRequest = beginRun(requestTracker, 'second')

    requestTracker.markApplied(firstRequest)
    requestTracker.finish(secondRequest)
    expect(requestTracker.begin('first')).not.toBeNull()

    const appliedRequest = beginRun(requestTracker, 'applied')
    requestTracker.markApplied(appliedRequest)
    const appliedController = new AbortController()
    expect(requestTracker.begin('applied', appliedController)).toBeNull()
    expect(appliedController.signal.aborted).toBe(true)
    expect(appliedRequest.controller.signal.aborted).toBe(true)
  })
})

function beginRun(
  requestTracker: ReturnType<typeof createRequestTracker>,
  requestKey: string
) {
  const request = requestTracker.begin(requestKey)
  expect(request).not.toBeNull()
  if (request == null) throw new Error(`Expected run decision for ${requestKey}`)
  return request
}
