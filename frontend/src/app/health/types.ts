export type HealthOverallStatus = 'healthy' | 'degraded' | 'unavailable'

export type HealthDatasetStatus =
  | 'fresh'
  | 'building'
  | 'stalled'
  | 'stale'
  | 'incomplete'
  | 'unavailable'

export type HealthProgress = {
  cycle: string
  published: boolean
  expected_markers: number
  found_markers: number
  missing_markers: number
  last_progress_at: string | null
  missing_sample: string[]
  invalid_marker_sample: string[]
}
export type HealthDataset = {
  dataset_id: string
  label: string
  status: HealthDatasetStatus
  reason: string
  expected_cycle: string | null
  expected_cycle_deadline: string | null
  latest_observed_cycle: string | null
  latest_published_cycle: string | null
  latest_published_generated_at: string | null
  progress: HealthProgress | null
  publish_lag: {
    grace_hours: number | null
    source: string
  }
}

export type HealthPayload = {
  schema: 'weather-map.health'
  schema_version: 1
  generated_at: string
  status: HealthOverallStatus
  datasets: HealthDataset[]
}
