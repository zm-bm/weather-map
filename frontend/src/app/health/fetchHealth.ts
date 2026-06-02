import type { HealthPayload } from './types'

export async function fetchHealth(signal?: AbortSignal): Promise<HealthPayload> {
  const res = await fetch('/api/health', { signal })
  if (!res.ok) throw new Error(`Failed to fetch health: ${res.status} ${res.statusText}`)
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    const preview = (await res.text()).trim().slice(0, 80).replace(/\s+/g, ' ')
    if (preview.toLowerCase().startsWith('<!doctype') || preview.startsWith('<')) {
      throw new Error('Health API returned HTML. Restart the dev server and make sure the backend /api proxy is running.')
    }
    throw new Error(`Health API returned ${contentType || 'an unknown content type'} instead of JSON.`)
  }
  const payload = await res.json()
  return parseHealthPayload(payload)
}

function parseHealthPayload(value: unknown): HealthPayload {
  if (!isObject(value)) throw new Error('Invalid health payload: expected object')
  if (value.schema !== 'weather-map.health') throw new Error('Invalid health payload schema')
  if (value.schema_version !== 1) throw new Error('Invalid health payload schema version')
  if (!isStatus(value.status)) throw new Error('Invalid health payload status')
  if (!Array.isArray(value.datasets)) throw new Error('Invalid health payload datasets')
  if (typeof value.generated_at !== 'string') throw new Error('Invalid health payload generated_at')
  return value as HealthPayload
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStatus(value: unknown): boolean {
  return value === 'healthy' || value === 'degraded' || value === 'unavailable'
}
