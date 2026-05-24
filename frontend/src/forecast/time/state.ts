export const DEFAULT_PLAY_MIN_INTERVAL_MS = 100
export const DEFAULT_PLAY_STEP_COUNT = 1

export type ForecastTimeState = {
  version: number
  appliedTimeMs: number
  targetTimeMs: number
  pendingTimeMs: number | null
  isInFlight: boolean
  isPlaying: boolean
  lastAppliedAtMs: number
}

export type ForecastTimeAction =
  | { type: 'requestTime'; timeMs: number }
  | { type: 'queueTime'; timeMs: number }
  | { type: 'playbackTick'; fromVersion: number; fromTimeMs: number; timeMs: number }
  | { type: 'requestStart'; timeMs: number }
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
  if (state.pendingTimeMs != null && state.pendingTimeMs !== timeMs) {
    return {
      ...state,
      version: nextVersion(state),
      appliedTimeMs: timeMs,
      targetTimeMs: state.pendingTimeMs,
      pendingTimeMs: null,
      isInFlight: true,
      lastAppliedAtMs: nowMs,
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
  }
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
