export const serverUrl = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080'

export const tilesUrl = import.meta.env.VITE_TILES_URL ?? 'http://localhost:8081'

export const manifestBaseUrl = import.meta.env.VITE_MANIFEST_BASE_URL ?? 'http://localhost:5173/manifests'

export const language = (navigator.language ?? 'en').split('-')[0]
