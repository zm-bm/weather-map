import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'

import {
  type ActiveForecastRun,
  type ForecastTimeSpec,
} from '../forecast-manifest'
import {
  clampForecastValidTimeMs,
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

const EMPTY_TIMES: ForecastTimeSpec[] = []

export default function ForecastTimeProvider({
  activeRun,
  children,
}: {
  activeRun: ActiveForecastRun | null
  children: ReactNode
}) {
  const times = activeRun?.latest.times ?? EMPTY_TIMES
  const forecastHourCount = times.length
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

  const queueTime = useCallback((targetTimeMs: number) => {
    dispatch({
      type: 'queueTime',
      timeMs: clampForecastValidTimeMs(times, targetTimeMs),
    })
  }, [times])

  const requestNext = useCallback(() => {
    const referenceTimeMs = state.pendingTimeMs ?? state.targetTimeMs
    queueTime(
      stepForecastValidTimeMs(
        times,
        referenceTimeMs,
        1
      )
    )
  }, [times, queueTime, state.pendingTimeMs, state.targetTimeMs])

  const requestPrev = useCallback(() => {
    const referenceTimeMs = state.pendingTimeMs ?? state.targetTimeMs
    queueTime(
      stepForecastValidTimeMs(
        times,
        referenceTimeMs,
        -1
      )
    )
  }, [times, queueTime, state.pendingTimeMs, state.targetTimeMs])

  const togglePlay = useCallback(() => {
    if (forecastHourCount <= 1) return
    dispatch({ type: 'togglePlay' })
  }, [forecastHourCount])

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

  const sync = useMemo(() => ({
    onRequestStart,
    onRequestApplied,
    onRequestError,
  }), [onRequestApplied, onRequestError, onRequestStart])

  useEffect(() => {
    if (!state.isPlaying || state.isInFlight || forecastHourCount <= 1) return
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
    forecastHourCount,
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
      requestNext,
      requestPrev,
      togglePlay,
    },
    sync,
  }), [
    times,
    requestTime,
    requestNext,
    requestPrev,
    togglePlay,
    state.appliedTimeMs,
    state.isInFlight,
    state.isPlaying,
    state.pendingTimeMs,
    state.targetTimeMs,
    sync,
  ])

  return (
    <ForecastTimeContext.Provider value={value}>
      {children}
    </ForecastTimeContext.Provider>
  )
}
