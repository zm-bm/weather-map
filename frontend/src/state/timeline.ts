export const DEFAULT_BUTTON_DEBOUNCE_MS = 250
export const DEFAULT_PLAY_MIN_INTERVAL_MS = 1500

export type TimelineState = {
  appliedHourIndex: number
  targetHourIndex: number
  pendingHourIndex: number | null
  pendingRetryAtMs: number | null
  isInFlight: boolean
  isPlaying: boolean
  lastDispatchAtMs: number
  lastAppliedAtMs: number
}

export type TimelineAction =
  | { type: 'requestHour'; hourIndex: number; nowMs: number; debounceMs: number }
  | { type: 'flushPending'; nowMs: number; debounceMs: number }
  | { type: 'requestStart'; hourIndex: number }
  | { type: 'requestApplied'; hourIndex: number; nowMs: number }
  | { type: 'requestError' }
  | { type: 'reset'; hourIndex: number; nowMs: number }
  | { type: 'togglePlay' }

export function createTimelineState(initialHourIndex: number): TimelineState {
  return {
    appliedHourIndex: initialHourIndex,
    targetHourIndex: initialHourIndex,
    pendingHourIndex: null,
    pendingRetryAtMs: null,
    isInFlight: false,
    isPlaying: false,
    lastDispatchAtMs: 0,
    lastAppliedAtMs: Date.now(),
  }
}

function clearPending(state: TimelineState): TimelineState {
  if (state.pendingHourIndex == null && state.pendingRetryAtMs == null) return state
  return { ...state, pendingHourIndex: null, pendingRetryAtMs: null }
}

function dispatchHour(state: TimelineState, hourIndex: number, nowMs: number): TimelineState {
  return {
    ...state,
    pendingHourIndex: null,
    pendingRetryAtMs: null,
    targetHourIndex: hourIndex,
    isInFlight: true,
    lastDispatchAtMs: nowMs,
  }
}

function queueHour(state: TimelineState, hourIndex: number, retryAtMs: number | null): TimelineState {
  if (state.pendingHourIndex === hourIndex && state.pendingRetryAtMs === retryAtMs) return state
  return { ...state, pendingHourIndex: hourIndex, pendingRetryAtMs: retryAtMs }
}

function computeRetryAtMs(lastDispatchAtMs: number, nowMs: number, debounceMs: number): number | null {
  const elapsedSinceDispatch = nowMs - lastDispatchAtMs
  if (elapsedSinceDispatch >= debounceMs) return null
  return nowMs + (debounceMs - elapsedSinceDispatch)
}

function reduceRequestHour(
  state: TimelineState,
  hourIndex: number,
  nowMs: number,
  debounceMs: number
): TimelineState {
  if (state.isInFlight) {
    if (hourIndex === state.targetHourIndex) return state
    return queueHour(state, hourIndex, null)
  }

  if (hourIndex === state.appliedHourIndex) return clearPending(state)

  const retryAtMs = computeRetryAtMs(state.lastDispatchAtMs, nowMs, debounceMs)
  if (retryAtMs != null) {
    return queueHour(state, hourIndex, retryAtMs)
  }

  return dispatchHour(state, hourIndex, nowMs)
}

function reduceFlushPending(
  state: TimelineState,
  nowMs: number,
  debounceMs: number
): TimelineState {
  if (state.pendingHourIndex == null || state.isInFlight) return state
  if (state.pendingHourIndex === state.appliedHourIndex) return clearPending(state)

  const retryAtMs = computeRetryAtMs(state.lastDispatchAtMs, nowMs, debounceMs)
  if (retryAtMs != null) {
    return queueHour(state, state.pendingHourIndex, retryAtMs)
  }

  return dispatchHour(state, state.pendingHourIndex, nowMs)
}

export function reduceTimelineState(
  state: TimelineState,
  action: TimelineAction
): TimelineState {
  if (action.type === 'reset') {
    return {
      ...createTimelineState(action.hourIndex),
      lastAppliedAtMs: action.nowMs,
    }
  }

  if (action.type === 'requestHour') {
    return reduceRequestHour(
      state,
      action.hourIndex,
      action.nowMs,
      action.debounceMs
    )
  }

  if (action.type === 'flushPending') {
    return reduceFlushPending(state, action.nowMs, action.debounceMs)
  }

  if (action.type === 'requestStart') {
    return {
      ...state,
      targetHourIndex: action.hourIndex,
      isInFlight: true,
    }
  }

  if (action.type === 'requestApplied') {
    return {
      ...state,
      appliedHourIndex: action.hourIndex,
      targetHourIndex: action.hourIndex,
      isInFlight: false,
      lastAppliedAtMs: action.nowMs,
    }
  }

  if (action.type === 'requestError') {
    return {
      ...state,
      pendingHourIndex: null,
      pendingRetryAtMs: null,
      isInFlight: false,
      isPlaying: false,
    }
  }

  if (action.type === 'togglePlay') {
    return { ...state, isPlaying: !state.isPlaying }
  }

  return state
}
