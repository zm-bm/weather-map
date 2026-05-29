export type ActiveRequest = {
  key: string
  controller: AbortController
}

export type RequestTracker = {
  reset: () => void
  abortActive: () => void
  begin: (requestKey: string, controller?: AbortController) => ActiveRequest | null
  isCurrent: (request: ActiveRequest) => boolean
  markApplied: (request: ActiveRequest) => void
  finish: (request: ActiveRequest) => void
}

export function createRequestTracker(): RequestTracker {
  let lastAppliedKey: string | null = null
  let active: ActiveRequest | null = null

  function abortActive() {
    active?.controller.abort()
    active = null
  }

  const requestTracker: RequestTracker = {
    reset() {
      abortActive()
      lastAppliedKey = null
    },
    abortActive,
    begin(requestKey, controller = new AbortController()) {
      if (lastAppliedKey === requestKey) {
        controller.abort()
        abortActive()
        return null
      }
      if (active?.key === requestKey) {
        controller.abort()
        return null
      }

      abortActive()
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
