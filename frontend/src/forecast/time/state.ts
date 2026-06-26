export const DEFAULT_PLAY_MIN_INTERVAL_MS = 75
export const DEFAULT_PLAY_STEP_COUNT = 5
export const MAX_PLAY_MIN_INTERVAL_MS = 250

const PLAYBACK_LATENCY_DELAY_FACTOR = 0.5
const REQUEST_LATENCY_EMA_ALPHA = 0.25

export type ForecastTimeState = {
  version: number
  appliedTimeMs: number
  targetTimeMs: number
  pendingTimeMs: number | null
  isInFlight: boolean
  isPlaying: boolean
  lastAppliedAtMs: number
  activeRequestStartedAtMs: number | null
  activeRequestTargetTimeMs: number | null
  smoothedApplyLatencyMs: number | null
}

export type ForecastTimeAction =
  | { type: 'requestTime'; timeMs: number }
  | { type: 'queueTime'; timeMs: number }
  | { type: 'playbackTick'; fromVersion: number; fromTimeMs: number; timeMs: number }
  | { type: 'requestStart'; timeMs: number; nowMs: number }
  | { type: 'requestApplied'; timeMs: number; nowMs: number }
  | { type: 'requestError' }
  | { type: 'reset'; timeMs: number; nowMs: number }
  | { type: 'togglePlay' }

export function createForecastTimeState(initialTimeMs: number): ForecastTimeState {
  return {
    version: 0,
    appliedTimeMs: initialTimeMs,
    targetTimeMs: initialTimeMs,
    pendingTimeMs: null,
    isInFlight: false,
    isPlaying: false,
    lastAppliedAtMs: Date.now(),
    activeRequestStartedAtMs: null,
    activeRequestTargetTimeMs: null,
    smoothedApplyLatencyMs: null,
  }
}

function nextVersion(state: ForecastTimeState): number {
  return state.version + 1
}

function clearPending(state: ForecastTimeState): ForecastTimeState {
  if (state.pendingTimeMs == null) return state
  return {
    ...state,
    version: nextVersion(state),
    pendingTimeMs: null,
  }
}

function dispatchTime(
  state: ForecastTimeState,
  timeMs: number
): ForecastTimeState {
  return {
    ...state,
    version: nextVersion(state),
    pendingTimeMs: null,
    targetTimeMs: timeMs,
    isInFlight: true,
    activeRequestStartedAtMs: null,
    activeRequestTargetTimeMs: null,
  }
}

function queueTime(
  state: ForecastTimeState,
  timeMs: number
): ForecastTimeState {
  if (state.pendingTimeMs === timeMs) return state
  return {
    ...state,
    version: nextVersion(state),
    pendingTimeMs: timeMs,
  }
}

function reduceRequestTime(
  state: ForecastTimeState,
  timeMs: number
): ForecastTimeState {
  if (timeMs === state.targetTimeMs) return clearPending(state)
  if (timeMs === state.appliedTimeMs) {
    return {
      ...state,
      version: nextVersion(state),
      targetTimeMs: timeMs,
      pendingTimeMs: null,
      isInFlight: false,
      activeRequestStartedAtMs: null,
      activeRequestTargetTimeMs: null,
    }
  }

  return dispatchTime(state, timeMs)
}

function reduceQueueTime(
  state: ForecastTimeState,
  timeMs: number
): ForecastTimeState {
  if (state.isInFlight) {
    if (timeMs === state.targetTimeMs) return clearPending(state)
    return queueTime(state, timeMs)
  }

  if (timeMs === state.appliedTimeMs) return clearPending(state)

  return dispatchTime(state, timeMs)
}

function reducePlaybackTick(
  state: ForecastTimeState,
  fromVersion: number,
  fromTimeMs: number,
  timeMs: number
): ForecastTimeState {
  if (state.version !== fromVersion) return state
  if (!state.isPlaying) return state
  if (state.isInFlight) return state
  if (state.pendingTimeMs != null) return state
  if (state.appliedTimeMs !== fromTimeMs) return state
  if (state.targetTimeMs !== fromTimeMs) return state
  if (timeMs === state.appliedTimeMs) return state

  return dispatchTime(state, timeMs)
}

function reduceRequestApplied(
  state: ForecastTimeState,
  timeMs: number,
  nowMs: number
): ForecastTimeState {
  const smoothedApplyLatencyMs = nextSmoothedApplyLatencyMs(state, timeMs, nowMs)

  if (state.pendingTimeMs != null && state.pendingTimeMs !== timeMs) {
    return {
      ...state,
      version: nextVersion(state),
      appliedTimeMs: timeMs,
      targetTimeMs: state.pendingTimeMs,
      pendingTimeMs: null,
      isInFlight: true,
      lastAppliedAtMs: nowMs,
      activeRequestStartedAtMs: null,
      activeRequestTargetTimeMs: null,
      smoothedApplyLatencyMs,
    }
  }

  return {
    ...state,
    version: nextVersion(state),
    appliedTimeMs: timeMs,
    targetTimeMs: timeMs,
    pendingTimeMs: null,
    isInFlight: false,
    lastAppliedAtMs: nowMs,
    activeRequestStartedAtMs: null,
    activeRequestTargetTimeMs: null,
    smoothedApplyLatencyMs,
  }
}

function nextSmoothedApplyLatencyMs(
  state: ForecastTimeState,
  timeMs: number,
  nowMs: number
): number | null {
  if (
    state.activeRequestStartedAtMs == null ||
    state.activeRequestTargetTimeMs !== timeMs
  ) {
    return state.smoothedApplyLatencyMs
  }

  const latencyMs = Math.max(0, nowMs - state.activeRequestStartedAtMs)
  if (state.smoothedApplyLatencyMs == null) return latencyMs

  return (
    (state.smoothedApplyLatencyMs * (1 - REQUEST_LATENCY_EMA_ALPHA)) +
    (latencyMs * REQUEST_LATENCY_EMA_ALPHA)
  )
}

export function resolvePlaybackMinIntervalMs(
  smoothedApplyLatencyMs: number | null
): number {
  if (smoothedApplyLatencyMs == null || !Number.isFinite(smoothedApplyLatencyMs)) {
    return DEFAULT_PLAY_MIN_INTERVAL_MS
  }

  return Math.max(
    DEFAULT_PLAY_MIN_INTERVAL_MS,
    Math.min(
      MAX_PLAY_MIN_INTERVAL_MS,
      smoothedApplyLatencyMs * PLAYBACK_LATENCY_DELAY_FACTOR
    )
  )
}

export function reduceForecastTimeState(
  state: ForecastTimeState,
  action: ForecastTimeAction
): ForecastTimeState {
  if (action.type === 'reset') {
    return {
      ...createForecastTimeState(action.timeMs),
      version: nextVersion(state),
      lastAppliedAtMs: action.nowMs,
    }
  }

  if (action.type === 'requestTime') {
    return reduceRequestTime(state, action.timeMs)
  }

  if (action.type === 'queueTime') {
    return reduceQueueTime(state, action.timeMs)
  }

  if (action.type === 'playbackTick') {
    return reducePlaybackTick(
      state,
      action.fromVersion,
      action.fromTimeMs,
      action.timeMs
    )
  }

  if (action.type === 'requestStart') {
    return {
      ...state,
      version: nextVersion(state),
      targetTimeMs: action.timeMs,
      isInFlight: true,
      activeRequestStartedAtMs: action.nowMs,
      activeRequestTargetTimeMs: action.timeMs,
    }
  }

  if (action.type === 'requestApplied') {
    return reduceRequestApplied(state, action.timeMs, action.nowMs)
  }

  if (action.type === 'requestError') {
    return {
      ...state,
      version: nextVersion(state),
      pendingTimeMs: null,
      isInFlight: false,
      isPlaying: false,
      activeRequestStartedAtMs: null,
      activeRequestTargetTimeMs: null,
    }
  }

  if (action.type === 'togglePlay') {
    return {
      ...state,
      version: nextVersion(state),
      isPlaying: !state.isPlaying,
    }
  }

  return state
}
