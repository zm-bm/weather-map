import { describe, expect, it } from 'vitest'

const sourceModules = import.meta.glob('../**/*.{ts,tsx}', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>

const IMPORT_SOURCE_PATTERN =
  /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g

type SourceFile = {
  path: string
  source: string
  imports: ImportReference[]
}

type ImportReference = {
  source: string
  resolvedPath: string
}

const sourceFiles: SourceFile[] = Object.entries(sourceModules)
  .filter(([path]) => !path.endsWith('/test/importBoundaries.test.ts'))
  .map(([path, source]) => ({
    path,
    source,
    imports: readImportReferences(path, source),
  }))

describe('frontend import boundaries', () => {
  it('keeps forecast data, probe, and render channel ownership separated', () => {
    const violations = [
      ...findSourceImportViolations(
        'Do not import removed map-probe modules',
        ({ imports }) => imports.some((reference) => isMapProbeImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Do not import forecast-render data/probe internals',
        ({ imports }) => imports.some((reference) => (
          /\/forecast-render\/[^/]+\/engine\/frame$/.test(reference.resolvedPath) ||
          /\/forecast-render\/[^/]+\/probe$/.test(reference.resolvedPath)
        ))
      ),
      ...findSourceImportViolations(
        'forecast-render must not import forecast-probe',
        (file) => isForecastRenderFile(file.path) &&
          file.imports.some((reference) => isForecastProbeImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Production map modules must not import forecast-render',
        (file) => isProductionMapFile(file.path) &&
          file.imports.some((reference) => isForecastRenderImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'forecast-sync must not import MapLibre or forecast-render internals',
        (file) => isForecastSyncFile(file.path) &&
          file.imports.some((reference) => (
            reference.resolvedPath === '/maplibre-gl' ||
            isForecastRenderSubmoduleImport(reference.resolvedPath)
          ))
      ),
      ...findSourceImportViolations(
        'Import forecast-render through its public module or options module',
        (file) => !isForecastRenderFile(file.path) &&
          file.imports.some((reference) => (
            isForecastRenderSubmoduleImport(reference.resolvedPath) &&
            reference.resolvedPath !== '/forecast-render/options'
          ))
      ),
      ...findSourceImportViolations(
        'Import forecast-probe through its public module',
        (file) => !file.path.includes('/forecast-probe/') &&
          file.imports.some((reference) => isForecastProbeSubmoduleImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Import forecast-data internals through forecast-data public modules',
        (file) => !file.path.includes('/forecast-data/') &&
          file.imports.some((reference) => isForecastDataInternalImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Import forecast-artifacts internals through forecast-artifacts public modules',
        (file) => !file.path.includes('/forecast-artifacts/') &&
          file.imports.some((reference) => isForecastArtifactsInternalImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Import forecast-selection through its public module',
        (file) => !file.path.includes('/forecast-selection/') &&
          file.imports.some((reference) => isForecastSelectionInternalImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Import app-status through its public module',
        (file) => !file.path.includes('/app-status/') &&
          file.imports.some((reference) => isAppStatusInternalImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Import forecast-time through its public module',
        (file) => !file.path.includes('/forecast-time/') &&
          file.imports.some((reference) => isForecastTimeInternalImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Use grouped map layer ids outside map view internals',
        (file) => !file.path.includes('/map/view/') &&
          file.imports.some((reference) => reference.resolvedPath.includes('/map/view/constants')) &&
          /\b(BASEMAP_SOURCE_ID|PLACE_SOURCE_LAYER_ID|PLACE_PROBE_SOURCE_ID|PLACE_PROBE_LAYER_ID|PLACE_LABEL_LAYER_IDS)\b/
            .test(file.source)
      ),
      ...findSourceImportViolations(
        'forecast-render must not import forecast-data loader modules or APIs',
        (file) => isForecastRenderFile(file.path) && (
          file.imports.some((reference) => isForecastDataInternalImport(reference.resolvedPath)) ||
          /\b(createForecastDataPlan|createArtifactLoader)\b/
            .test(file.source)
        )
      ),
      ...findSourceImportViolations(
        'forecast-render must not expose sync runner APIs',
        (file) => isForecastRenderFile(file.path) && /\bapplySync\b/.test(file.source)
      ),
    ]

    expect(violations).toEqual([])
  })
})

function readImportReferences(path: string, source: string): ImportReference[] {
  const imports: ImportReference[] = []
  for (const match of source.matchAll(IMPORT_SOURCE_PATTERN)) {
    const importSource = match[1]
    if (importSource) {
      imports.push({
        source: importSource,
        resolvedPath: resolveImportPath(path, importSource),
      })
    }
  }
  return imports
}

function resolveImportPath(fromPath: string, importSource: string): string {
  if (!importSource.startsWith('.')) return `/${importSource}`

  const fromDir = fromPath.slice(0, fromPath.lastIndexOf('/'))
  return stripKnownExtension(normalizePath(`${fromDir}/${importSource}`))
}

function normalizePath(path: string): string {
  const parts: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return `/${parts.join('/')}`
}

function stripKnownExtension(path: string): string {
  return path.replace(/\.(tsx?|jsx?)$/, '')
}

function findSourceImportViolations(
  label: string,
  predicate: (file: SourceFile) => boolean
): string[] {
  return sourceFiles
    .filter(predicate)
    .map((file) => `${label}: ${file.path}`)
}

function isForecastRenderFile(path: string): boolean {
  return path.includes('/forecast-render/')
}

function isForecastSyncFile(path: string): boolean {
  return path.includes('/forecast-sync/')
}

function isProductionMapFile(path: string): boolean {
  return path.includes('/map/') && !/\.(test|spec)\.tsx?$/.test(path)
}

function isForecastRenderImport(path: string): boolean {
  return path === '/forecast-render' || path.includes('/forecast-render/')
}

function isForecastRenderSubmoduleImport(path: string): boolean {
  return path.includes('/forecast-render/')
}

function isMapProbeImport(path: string): boolean {
  return path === '/map-probe' || path.includes('/map-probe/')
}

function isForecastProbeImport(path: string): boolean {
  return path === '/forecast-probe' || isForecastProbeSubmoduleImport(path)
}

function isForecastProbeSubmoduleImport(path: string): boolean {
  return path.includes('/forecast-probe/')
}

function isForecastDataInternalImport(path: string): boolean {
  return path.includes('/forecast-data/plan') ||
    path.includes('/forecast-data/load') ||
    path.includes('/forecast-data/prefetch') ||
    path.includes('/forecast-data/memory') ||
    path.includes('/forecast-data/field/') ||
    path.includes('/forecast-data/particles/') ||
    path.includes('/forecast-data/keys') ||
    path.includes('/forecast-data/target') ||
    path.includes('/forecast-data/types') ||
    path.includes('/forecast-data/window')
}

function isForecastArtifactsInternalImport(path: string): boolean {
  return path.includes('/forecast-artifacts/data') ||
    path.includes('/forecast-artifacts/payload') ||
    path.includes('/forecast-artifacts/types')
}

function isForecastSelectionInternalImport(path: string): boolean {
  return path.includes('/forecast-selection/ForecastSelectionContext') ||
    path.includes('/forecast-selection/ForecastSelectionProvider')
}

function isAppStatusInternalImport(path: string): boolean {
  return path.includes('/app-status/AppStatusContext') ||
    path.includes('/app-status/AppStatusProvider') ||
    path.includes('/app-status/state')
}

function isForecastTimeInternalImport(path: string): boolean {
  return path.includes('/forecast-time/ForecastTimeContext') ||
    path.includes('/forecast-time/ForecastTimeProvider') ||
    path.includes('/forecast-time/format') ||
    path.includes('/forecast-time/state') ||
    path.includes('/forecast-time/time') ||
    path.includes('/forecast-time/types')
}
