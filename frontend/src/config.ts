import { joinUrl } from './url/joinUrl'

const frontendBaseUrl = globalThis.location?.origin ?? 'http://localhost:5173'
const dataBaseUrl = import.meta.env.VITE_DATA_BASE_URL ?? 'http://localhost:3000'
const basemapFilename = import.meta.env.VITE_BASEMAP_FILENAME?.trim()
const basemapHttpUrl = basemapFilename ? joinUrl(dataBaseUrl, `pmtiles/${basemapFilename}`) : undefined

export default {
  dataBaseUrl,
  manifestBaseUrl: joinUrl(dataBaseUrl, 'manifests'),
  mapGlyphsUrl:
    import.meta.env.VITE_MAP_GLYPHS_URL ?? joinUrl(frontendBaseUrl, 'glyphs/{fontstack}/{range}.pbf'),
  basemapUrl: basemapHttpUrl ? `pmtiles://${basemapHttpUrl}` : undefined,
  radioBaseUrl: import.meta.env.VITE_RADIO_BASE_URL ?? joinUrl(dataBaseUrl, 'radio'),
  verifyPayloadSha256: import.meta.env.VITE_VERIFY_PAYLOAD_SHA256 === 'true',
}

export type WeatherMapConfig = {
  dataBaseUrl: string
  manifestBaseUrl: string
  mapGlyphsUrl: string
  basemapUrl?: string
  radioBaseUrl: string
  verifyPayloadSha256: boolean
}
