import { useCallback, useEffect, useState } from 'react'

import { fetchHealth } from './fetchHealth'
import type { HealthModel, HealthPayload } from './types'

type HealthState = {
  loading: boolean
  payload: HealthPayload | null
  error: Error | null
  checkedAt: Date | null
}

const STATUS_LABELS: Record<string, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  unavailable: 'Unavailable',
  fresh: 'Fresh',
  building: 'Building',
  stalled: 'Stalled',
  stale: 'Stale',
  incomplete: 'Incomplete',
}

const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function HealthPage() {
  const [state, setState] = useState<HealthState>({
    loading: true,
    payload: null,
    error: null,
    checkedAt: null,
  })

  const requestHealth = useCallback((signal?: AbortSignal) => {
    fetchHealth(signal)
      .then((payload) => {
        if (signal?.aborted) return
        setState({
          loading: false,
          payload,
          error: null,
          checkedAt: new Date(),
        })
      })
      .catch((err) => {
        if (signal?.aborted) return
        setState({
          loading: false,
          payload: null,
          error: err instanceof Error ? err : new Error(String(err)),
          checkedAt: new Date(),
        })
      })
  }, [])

  const refresh = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }))
    requestHealth()
  }, [requestHealth])

  useEffect(() => {
    const ac = new AbortController()
    requestHealth(ac.signal)
    return () => ac.abort()
  }, [requestHealth])

  const overallStatus = state.payload?.status ?? (state.error ? 'unavailable' : 'degraded')
  const headline = getHeadline(state.payload, state.error)
  const statusLine = getStatusLine(state.payload, state.error, state.loading)

  return (
    <main className={`health-page health-page--${headline.tone}`}>
      <section className="health-page__header">
        <div>
          <p className="health-page__eyebrow wm-display-caps">Weather Map Health</p>
          <h1 className="health-page__title">{headline.label}</h1>
          <p className="health-page__summary">
            {state.error
              ? state.error.message
              : state.payload
                ? `Health snapshot generated ${formatDateTime(state.payload.generatedAt)}.`
                : 'Checking forecast artifact health.'}
          </p>
          <p className="health-page__status-line">{statusLine}</p>
        </div>
        <button className="health-page__refresh wm-bevel-button" type="button" onClick={refresh} disabled={state.loading}>
          {state.loading ? 'Checking' : 'Refresh'}
        </button>
      </section>

      <section className="health-page__meta" aria-label="Health metadata">
        <span>Checked {state.checkedAt ? DATE_TIME.format(state.checkedAt) : '--'}</span>
        <span>API {state.payload ? 'online' : state.error ? 'unavailable' : 'pending'}</span>
        <span>Overall {STATUS_LABELS[overallStatus]}</span>
      </section>

      <section className="health-page__models" aria-label="Forecast model health">
        {state.payload?.models.map((model) => (
          <ModelHealthCard key={model.id} model={model} />
        ))}
        {!state.payload && (
          <div className="health-card health-card--empty">
            <h2>{state.loading ? 'Checking models' : 'Health unavailable'}</h2>
            <p>{state.loading ? 'Waiting for the health API response.' : state.error?.message ?? 'No health payload was returned.'}</p>
          </div>
        )}
      </section>
    </main>
  )
}

function ModelHealthCard({ model }: { model: HealthModel }) {
  const progress = model.progress
  const markerPercent = progress && progress.expectedMarkers > 0
    ? Math.round((progress.foundMarkers / progress.expectedMarkers) * 100)
    : null

  return (
    <article className={`health-card health-card--${model.status}`}>
      <div className="health-card__header">
        <div>
          <h2>{model.label}</h2>
          <p>{model.reason}</p>
        </div>
        <span className="health-card__status wm-display-caps">{STATUS_LABELS[model.status]}</span>
      </div>

      <dl className="health-card__facts">
        <Fact label="Expected" value={formatCycle(model.expectedCycle)} />
        <Fact label="Expected By" value={formatDateTime(model.expectedCycleDeadline)} />
        <Fact label="Published Cycle" value={formatCycle(model.latestPublishedCycle)} />
        <Fact label="Latest Seen" value={formatCycle(model.latestObservedCycle)} />
        <Fact label="Published At" value={formatDateTime(model.latestPublishedGeneratedAt)} />
        <Fact label="Grace Window" value={model.publishLag.graceHours == null ? '--' : `${model.publishLag.graceHours}h`} />
      </dl>

      {progress && (
        <div className="health-card__progress" aria-label={`${model.label} marker progress`}>
          <div className="health-card__progress-label">
            <span>Cycle {formatCycle(progress.cycle)}</span>
            <span>{markerPercent == null ? '--' : `${markerPercent}%`}</span>
          </div>
          <div className="health-card__meter" aria-hidden="true">
            <span style={{ width: `${markerPercent ?? 0}%` }} />
          </div>
          <p>
            {progress.foundMarkers}/{progress.expectedMarkers} markers
            {progress.missingMarkers > 0 ? `, ${progress.missingMarkers} missing` : ', complete'}
            {progress.lastProgressAt ? `, last progress ${formatDateTime(progress.lastProgressAt)}` : ''}
          </p>
          {(progress.missingSample.length > 0 || progress.invalidMarkerSample.length > 0) && (
            <details className="health-card__details">
              <summary>Marker details</summary>
              {progress.missingSample.length > 0 && (
                <p>Missing sample: {progress.missingSample.slice(0, 4).join(', ')}</p>
              )}
              {progress.invalidMarkerSample.length > 0 && (
                <p>Invalid markers: {progress.invalidMarkerSample.slice(0, 4).join(', ')}</p>
              )}
            </details>
          )}
        </div>
      )}
    </article>
  )
}

function Fact({ label, value }: { label: string, value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function getHeadline(payload: HealthPayload | null, error: Error | null): { label: string, tone: string } {
  if (error) return { label: 'API Offline', tone: 'unavailable' }
  if (!payload) return { label: 'Checking', tone: 'checking' }
  if (payload.status === 'healthy') return { label: 'Healthy', tone: 'healthy' }
  if (payload.models.length > 0 && payload.models.every((model) => model.status === 'stale')) {
    return { label: 'Data Stale', tone: 'stale' }
  }
  if (payload.models.some((model) => model.status === 'building')) {
    return { label: 'Building', tone: 'building' }
  }
  if (payload.status === 'unavailable') return { label: 'Unavailable', tone: 'unavailable' }
  return { label: 'Needs Review', tone: 'degraded' }
}

function getStatusLine(payload: HealthPayload | null, error: Error | null, loading: boolean): string {
  if (error) return 'API unavailable'
  if (!payload) return loading ? 'Checking API and artifact status' : 'No health payload returned'
  const modelSummary = payload.models
    .map((model) => `${model.label} ${STATUS_LABELS[model.status].toLowerCase()}`)
    .join(' · ')
  return modelSummary ? `${modelSummary} · API online` : 'API online'
}

function formatCycle(cycle: string | null | undefined): string {
  if (!cycle || !/^\d{10}$/.test(cycle)) return '--'
  return `${cycle.slice(0, 4)}-${cycle.slice(4, 6)}-${cycle.slice(6, 8)} ${cycle.slice(8, 10)}Z`
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return DATE_TIME.format(date)
}

export default HealthPage
