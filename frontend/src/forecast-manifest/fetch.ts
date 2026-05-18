import config from '../config'
import { joinUrl } from '../url/joinUrl'
import { parseManifest } from './parse'
import type { Manifest } from './schema'

export async function fetchManifest(opts?: {
  signal?: AbortSignal
}): Promise<Manifest> {
  const manifestUrl = joinUrl(config.artifactBaseUrl, 'manifests/forecast-manifest.json')
  const res = await fetch(manifestUrl, { signal: opts?.signal })
  if (!res.ok) throw new Error(`Failed to fetch forecast manifest: ${res.status} ${res.statusText}`)
  return parseManifest(await res.json())
}
