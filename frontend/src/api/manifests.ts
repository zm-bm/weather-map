import config from '../config'

export type LatestManifest = {
	cycle: string
	generated_at: string
	revision: string
}

export type CycleManifest = {
	cycle: string
	forecast_hours: string[]
	layers: string[]
	min_zoom: number
	max_zoom: number
}

function isLatestManifest(v: unknown): v is LatestManifest {
	if (!v || typeof v !== 'object') return false
	const o = v as Record<string, unknown>
	return (
		typeof o.cycle === 'string' &&
		typeof o.generated_at === 'string' &&
		typeof o.revision === 'string'
	)
}

export async function fetchLatestManifest(opts?: { signal?: AbortSignal }): Promise<LatestManifest> {
	const latestUrl = `${config.manifestBaseUrl}/latest.json`
	const res = await fetch(latestUrl, { signal: opts?.signal })
	if (!res.ok) throw new Error(`Failed to fetch latest manifest: ${res.status} ${res.statusText}`)

	const json: unknown = await res.json()
	if (!isLatestManifest(json)) throw new Error('latest.json missing valid { cycle, generated_at, revision }')
	return json
}

export async function fetchCycleManifest(
	cycle: string,
	opts?: { signal?: AbortSignal }
): Promise<CycleManifest> {
  const cycleUrl = `${config.manifestBaseUrl}/${cycle}.json`
	const res = await fetch(cycleUrl, { signal: opts?.signal })
	if (!res.ok) throw new Error(`Failed to fetch cycle manifest: ${res.status} ${res.statusText}`)
	return (await res.json()) as CycleManifest
}

export async function fetchLatestCycleManifest(opts?: { signal?: AbortSignal }): Promise<CycleManifest> {
	const latest = await fetchLatestManifest(opts)
	return fetchCycleManifest(latest.cycle, opts)
}
