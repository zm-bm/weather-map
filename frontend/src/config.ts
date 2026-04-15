const parseBooleanEnv = (value: unknown): boolean => {
  if (typeof value !== 'string') return false
  return value.trim().toLowerCase() === 'true'
}

export default {
  serverUrl: import.meta.env.VITE_SERVER_URL ?? 'https://weather-tiles.zmbm.dev',
  manifestBaseUrl: import.meta.env.VITE_MANIFEST_BASE_URL ?? 'https://weather-tiles.zmbm.dev/manifests/',
  verifyScalarSha256: parseBooleanEnv(import.meta.env.VITE_VERIFY_SCALAR_SHA256),
  language: (navigator.language ?? 'en').split('-')[0],
}

export type WeatherMapConfig = {
  serverUrl: string
  manifestBaseUrl: string
  verifyScalarSha256: boolean

  language: string
}
