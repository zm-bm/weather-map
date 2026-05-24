import type { ForecastDataTarget } from '@/forecast/data'
import type { ForecastRenderHost } from '@/forecast/render'

export type RequestDecision =
  | { kind: 'disabled' }
  | { kind: 'blocked' }
  | { kind: 'pending' }
  | { kind: 'run'; renderHost: ForecastRenderHost; target: ForecastDataTarget }

export type ActiveRequest = {
  key: string
  controller: AbortController
}

export type RequestTracker = {
  prepare: (args: {
    isBlocked: boolean
    renderHost: ForecastRenderHost | null
    target: ForecastDataTarget | null
  }) => RequestDecision
  reset: () => void
  abort: () => void
  isApplied: (requestKey: string) => boolean
  isActive: (requestKey: string) => boolean
  start: (requestKey: string, controller?: AbortController) => ActiveRequest
  isCurrent: (request: ActiveRequest) => boolean
  markApplied: (request: ActiveRequest) => void
  finish: (request: ActiveRequest) => void
}

export function createRequestTracker(): RequestTracker {
  let lastAppliedKey: string | null = null
  let active: ActiveRequest | null = null

  const requestTracker: RequestTracker = {
    prepare({ isBlocked, renderHost, target }) {
      if (target == null) {
        requestTracker.reset()
        return { kind: 'disabled' }
      }
      if (isBlocked) {
        requestTracker.abort()
        return { kind: 'blocked' }
      }
      if (renderHost == null) {
        requestTracker.abort()
        return { kind: 'pending' }
      }

      return { kind: 'run', renderHost, target }
    },
    reset() {
      active?.controller.abort()
      active = null
      lastAppliedKey = null
    },
    abort() {
      active?.controller.abort()
      active = null
    },
    isApplied(requestKey) {
      return lastAppliedKey === requestKey
    },
    isActive(requestKey) {
      return active?.key === requestKey
    },
    start(requestKey, controller = new AbortController()) {
      active?.controller.abort()
      const request = {
        key: requestKey,
        controller,
      }
      active = request
      return request
    },
    isCurrent(request) {
      return active === request && !request.controller.signal.aborted
    },
    markApplied(request) {
      if (active !== request) return
      lastAppliedKey = request.key
    },
    finish(request) {
      if (active !== request) return
      active = null
    },
  }

  return requestTracker
}
