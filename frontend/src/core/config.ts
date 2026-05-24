import { joinUrl } from './url/joinUrl'

const frontendBaseUrl = globalThis.location?.origin ?? 'http://localhost:5173'
const artifactBaseUrl = import.meta.env.VITE_ARTIFACT_BASE_URL ?? frontendBaseUrl
const basemapFilename = import.meta.env.VITE_BASEMAP_FILENAME?.trim()
const basemapHttpUrl = basemapFilename
  ? joinUrl(artifactBaseUrl, `pmtiles/${basemapFilename}`)
  : undefined

const config: WeatherMapConfig = {
  frontendBaseUrl,
  artifactBaseUrl,
  basemapUrl: basemapHttpUrl ? `pmtiles://${basemapHttpUrl}` : undefined,
}

export type WeatherMapConfig = {
  frontendBaseUrl: string
  artifactBaseUrl: string
  basemapUrl?: string
}

export default config
