export default {
  defaultLayer: 'temp2m',
  defaultHour: '000',

  serverUrl: import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080',
  tilesUrl: import.meta.env.VITE_TILES_URL ?? 'http://localhost:8081',
  manifestBaseUrl: import.meta.env.VITE_MANIFEST_BASE_URL ?? 'http://localhost:5173/manifests',

  language: (navigator.language ?? 'en').split('-')[0],
}
