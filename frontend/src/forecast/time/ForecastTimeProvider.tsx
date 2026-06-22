import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'

import type { ActiveForecastRun } from '@/forecast/manifest'
import {
  clampForecastValidTimeMs,
  type ForecastTimelineTime,
  initialForecastValidTimeMs,
  stepForecastValidTimeMs,
} from './time'
import {
  createForecastTimeState,
  DEFAULT_PLAY_MIN_INTERVAL_MS,
  DEFAULT_PLAY_STEP_COUNT,
  reduceForecastTimeState,
} from './state'
import { ForecastTimeContext, type ForecastTimeContextValue } from './ForecastTimeContext'

const EMPTY_TIMES: ForecastTimelineTime[] = []

export default function ForecastTimeProvider({
  activeRun,
  children,
}: {
  activeRun: ActiveForecastRun | null
  children: ReactNode
}) {
  return (
    <ForecastTimeProviderInner
      key={forecastTimeProviderKey(activeRun)}
      activeRun={activeRun}
    >
      {children}
    </ForecastTimeProviderInner>
  )
}

function forecastTimeProviderKey(activeRun: ActiveForecastRun | null): string {
  if (activeRun == null) return 'forecast-time:none'
  const timelineKey = activeRun.latest.frames.map((time) => `${time.id}:${time.valid_at}`).join(',')
  return `forecast-time:${activeRun.datasetId}:${activeRun.latest.run.cycle}:${timelineKey}`
}

function ForecastTimeProviderInner({
  activeRun,
  children,
}: {
  activeRun: ActiveForecastRun | null
  children: ReactNode
}) {
  const times = activeRun?.latest.frames ?? EMPTY_TIMES
  const frameCount = times.length
  const initialTimeMs = initialForecastValidTimeMs(times)

  const [state, dispatch] = useReducer(
    reduceForecastTimeState,
    initialTimeMs,
    createForecastTimeState
  )

  const requestTime = useCallback((targetTimeMs: number) => {
    dispatch({
      type: 'requestTime',
      timeMs: clampForecastValidTimeMs(times, targetTimeMs),
    })
  }, [times])

  const resetToNow = useCallback(() => {
    const nowMs = Date.now()
    dispatch({
      type: 'reset',
      timeMs: initialForecastValidTimeMs(times, nowMs),
      nowMs,
    })
  }, [times])

  const togglePlay = useCallback(() => {
    if (frameCount <= 1) return
    dispatch({ type: 'togglePlay' })
  }, [frameCount])

  const onRequestStart = useCallback((timeMs: number) => {
    dispatch({
      type: 'requestStart',
      timeMs: clampForecastValidTimeMs(times, timeMs),
    })
  }, [times])

  const onRequestApplied = useCallback((timeMs: number) => {
    dispatch({
      type: 'requestApplied',
      timeMs: clampForecastValidTimeMs(times, timeMs),
      nowMs: Date.now(),
    })
  }, [times])

  const onRequestError = useCallback(() => {
    dispatch({ type: 'requestError' })
  }, [])

  const syncCallbacks = useMemo(() => ({
    onRequestStart,
    onRequestApplied,
    onRequestError,
  }), [onRequestApplied, onRequestError, onRequestStart])

  useEffect(() => {
    if (!state.isPlaying || state.isInFlight || frameCount <= 1) return
    const elapsedMs = Date.now() - state.lastAppliedAtMs
    const delayMs = Math.max(0, DEFAULT_PLAY_MIN_INTERVAL_MS - elapsedMs)
    const fromVersion = state.version
    const fromTimeMs = state.appliedTimeMs
    const timeMs = stepForecastValidTimeMs(
      times,
      fromTimeMs,
      DEFAULT_PLAY_STEP_COUNT
    )

    const timerId = window.setTimeout(() => {
      dispatch({
        type: 'playbackTick',
        fromVersion,
        fromTimeMs,
        timeMs,
      })
    }, delayMs)

    return () => window.clearTimeout(timerId)
  }, [
    times,
    frameCount,
    state.appliedTimeMs,
    state.isInFlight,
    state.isPlaying,
    state.lastAppliedAtMs,
    state.version,
  ])

  const value = useMemo<ForecastTimeContextValue>(() => ({
    times,
    state: {
      appliedTimeMs: state.appliedTimeMs,
      targetTimeMs: state.targetTimeMs,
      pendingTimeMs: state.pendingTimeMs,
      isInFlight: state.isInFlight,
      isPlaying: state.isPlaying,
    },
    controls: {
      requestTime,
      resetToNow,
      togglePlay,
    },
    syncCallbacks,
  }), [
    times,
    requestTime,
    resetToNow,
    togglePlay,
    state.appliedTimeMs,
    state.isInFlight,
    state.isPlaying,
    state.pendingTimeMs,
    state.targetTimeMs,
    syncCallbacks,
  ])

  return (
    <ForecastTimeContext.Provider value={value}>
      {children}
    </ForecastTimeContext.Provider>
  )
}
