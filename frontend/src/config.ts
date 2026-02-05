export default {
  defaultLayer: 'temp2m',
  defaultHour: '000',

  serverUrl: import.meta.env.VITE_SERVER_URL ?? 'weather-tiles.zmbm.dev',
  manifestBaseUrl: import.meta.env.VITE_MANIFEST_BASE_URL ?? 'weather-tiles.zmbm.dev/manifest/',

  language: (navigator.language ?? 'en').split('-')[0],
}

export type WeatherMapConfig = {
  defaultLayer: string
  defaultHour: string

  serverUrl: string
  manifestBaseUrl: string

  language: string
}
