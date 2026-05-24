export type HealthOverallStatus = 'healthy' | 'degraded' | 'unavailable'

export type HealthModelStatus =
  | 'fresh'
  | 'building'
  | 'stalled'
  | 'stale'
  | 'incomplete'
  | 'unavailable'

export type HealthProgress = {
  cycle: string
  published: boolean
  expectedMarkers: number
  foundMarkers: number
  missingMarkers: number
  lastProgressAt: string | null
  missingSample: string[]
  invalidMarkerSample: string[]
}
export type HealthModel = {
  id: string
  label: string
  status: HealthModelStatus
  reason: string
  expectedCycle: string | null
  expectedCycleDeadline: string | null
  latestObservedCycle: string | null
  latestPublishedCycle: string | null
  latestPublishedGeneratedAt: string | null
  progress: HealthProgress | null
  publishLag: {
    graceHours: number | null
    source: string
  }
}

export type HealthPayload = {
  schema: 'weather-map.health'
  schemaVersion: 1
  generatedAt: string
  status: HealthOverallStatus
  models: HealthModel[]
}
