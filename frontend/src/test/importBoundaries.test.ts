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
        'Do not import forecast/render window/probe internals',
        ({ imports }) => imports.some((reference) => (
          /\/forecast\/render\/[^/]+\/engine\/frame$/.test(reference.resolvedPath) ||
          /\/forecast\/render\/[^/]+\/probe$/.test(reference.resolvedPath)
        ))
      ),
      ...findSourceImportViolations(
        'forecast/render may only import the pure forecast/settings contract',
        (file) => isForecastRenderFile(file.path) &&
          file.imports.some((reference) => (
            isForecastSettingsImport(reference.resolvedPath) &&
            !isForecastSettingsContractImport(reference.resolvedPath)
          ))
      ),
      ...findSourceImportViolations(
        'units must stay independent of app and forecast modules',
        (file) => isUnitsFile(file.path) &&
          !isTestFile(file.path) &&
          file.imports.some((reference) => (
            isAppImport(reference.resolvedPath) ||
            isForecastModuleImport(reference.resolvedPath) ||
            isForecastUiImport(reference.resolvedPath) ||
            isMapImport(reference.resolvedPath) ||
            reference.resolvedPath === '/react' ||
            reference.resolvedPath.includes('/test/')
          ))
      ),
      ...findSourceImportViolations(
        'forecast/display/legend must stay independent of app, catalog, frame, map, render, and sync modules',
        (file) => isForecastLegendFile(file.path) &&
          file.imports.some((reference) => (
            isAppImport(reference.resolvedPath) ||
            isForecastUiImport(reference.resolvedPath) ||
            isForecastCatalogImport(reference.resolvedPath) ||
            isForecastFrameImport(reference.resolvedPath) ||
            isForecastManifestImport(reference.resolvedPath) ||
            isForecastRenderImport(reference.resolvedPath) ||
            isForecastSyncImport(reference.resolvedPath) ||
            isMapImport(reference.resolvedPath)
          ))
      ),
      ...findSourceImportViolations(
        'forecast/display/palette must stay independent of app and forecast runtime modules',
        (file) => isForecastPaletteFile(file.path) &&
          file.imports.some((reference) => (
            isAppImport(reference.resolvedPath) ||
            isForecastUiImport(reference.resolvedPath) ||
            isForecastCatalogImport(reference.resolvedPath) ||
            isForecastFrameImport(reference.resolvedPath) ||
            isForecastLegendImport(reference.resolvedPath) ||
            isForecastManifestImport(reference.resolvedPath) ||
            isForecastRenderImport(reference.resolvedPath) ||
            isForecastSettingsImport(reference.resolvedPath) ||
            isForecastSyncImport(reference.resolvedPath) ||
            isMapImport(reference.resolvedPath) ||
            isUnitsImport(reference.resolvedPath) ||
            reference.resolvedPath === '/react' ||
            reference.resolvedPath.includes('/test/')
          ))
      ),
      ...findSourceImportViolations(
        'forecast/display/profiles must stay display-only',
        (file) => isForecastDisplayProfilesFile(file.path) &&
          file.imports.some((reference) => (
            isAppImport(reference.resolvedPath) ||
            isForecastCatalogImport(reference.resolvedPath) ||
            isForecastFrameImport(reference.resolvedPath) ||
            isForecastManifestImport(reference.resolvedPath) ||
            isForecastRenderImport(reference.resolvedPath) ||
            isForecastSettingsImport(reference.resolvedPath) ||
            isForecastSyncImport(reference.resolvedPath) ||
            isForecastUiImport(reference.resolvedPath) ||
            isMapImport(reference.resolvedPath) ||
            reference.resolvedPath === '/react'
          ))
      ),
      ...findSourceImportViolations(
        'math must stay dependency-free',
        (file) => isMathFile(file.path) && file.imports.length > 0
      ),
      ...findSourceImportViolations(
        'geo must stay pure coordinate math',
        (file) => isGeoFile(file.path) &&
          file.imports.some((reference) => reference.resolvedPath !== '/core/math')
      ),
      ...findSourceImportViolations(
        'Forecast runtime modules must not import app composition or forecast UI',
        (file) => isForecastRuntimeFile(file.path) &&
          !isTestFile(file.path) &&
          file.imports.some((reference) => (
            isAppImport(reference.resolvedPath) ||
            isForecastUiImport(reference.resolvedPath)
          ))
      ),
      ...findSourceImportViolations(
        'forecast/place-probes must stay independent of app, forecast UI, non-frame forecast modules, units, and map internals',
        (file) => isForecastPlaceProbesFile(file.path) &&
          !isTestFile(file.path) &&
          file.imports.some((reference) => (
            isAppImport(reference.resolvedPath) ||
            isForecastUiImport(reference.resolvedPath) ||
            (
              isForecastModuleImport(reference.resolvedPath) &&
              !isForecastFrameImport(reference.resolvedPath) &&
              !isForecastCatalogSourceImport(reference.resolvedPath) &&
              !isForecastPlaceProbesImport(reference.resolvedPath)
            ) ||
            (
              isMapImport(reference.resolvedPath) &&
              reference.resolvedPath !== '/map/basemap'
            ) ||
            isUnitsImport(reference.resolvedPath) ||
            reference.resolvedPath === '/react'
          ))
      ),
      ...findSourceImportViolations(
        'forecast/manifest must not import forecast/catalog',
        (file) => isForecastManifestFile(file.path) &&
          file.imports.some((reference) => isForecastCatalogImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'forecast/catalog must stay independent of React, app, render, sync, settings, UI, map, and place-probe modules',
        (file) => isForecastCatalogFile(file.path) &&
          !isTestFile(file.path) &&
          file.imports.some((reference) => (
            isAppImport(reference.resolvedPath) ||
            isForecastRenderImport(reference.resolvedPath) ||
            isForecastSyncImport(reference.resolvedPath) ||
            isForecastSettingsImport(reference.resolvedPath) ||
            isForecastUiImport(reference.resolvedPath) ||
            isForecastPlaceProbesImport(reference.resolvedPath) ||
            isMapImport(reference.resolvedPath) ||
            reference.resolvedPath === '/react'
          ))
      ),
      ...findSourceImportViolations(
        'forecast/cache must stay generic cache infrastructure',
        (file) => isForecastCacheFile(file.path) &&
          !isTestFile(file.path) &&
          file.imports.some((reference) => (
            isAppImport(reference.resolvedPath) ||
            (
              isForecastModuleImport(reference.resolvedPath) &&
              !isForecastCacheImport(reference.resolvedPath)
            ) ||
            isMapImport(reference.resolvedPath) ||
            reference.resolvedPath === '/react'
          ))
      ),
      ...findSourceImportViolations(
        'forecast/artifacts must stay independent of render, sync, catalog, settings, map, app, and UI modules',
        (file) => isForecastArtifactsFile(file.path) &&
          !isTestFile(file.path) &&
          file.imports.some((reference) => (
            isAppImport(reference.resolvedPath) ||
            isForecastCatalogImport(reference.resolvedPath) ||
            isForecastRenderImport(reference.resolvedPath) ||
            isForecastSettingsImport(reference.resolvedPath) ||
            isForecastSyncImport(reference.resolvedPath) ||
            isForecastUiImport(reference.resolvedPath) ||
            isMapImport(reference.resolvedPath) ||
            reference.resolvedPath === '/react'
          ))
      ),
      ...findSourceImportViolations(
        'forecast/frames must stay independent of React, app, catalog entries, render, sync, settings, UI, map, and place-probe modules',
        (file) => isForecastFrameFile(file.path) &&
          !isTestFile(file.path) &&
          file.imports.some((reference) => (
            isAppImport(reference.resolvedPath) ||
            (
              isForecastCatalogImport(reference.resolvedPath) &&
              !isForecastCatalogSourceImport(reference.resolvedPath)
            ) ||
            isForecastRenderImport(reference.resolvedPath) ||
            isForecastSyncImport(reference.resolvedPath) ||
            isForecastSettingsImport(reference.resolvedPath) ||
            isForecastUiImport(reference.resolvedPath) ||
            isForecastPlaceProbesImport(reference.resolvedPath) ||
            isMapImport(reference.resolvedPath) ||
            reference.resolvedPath === '/react'
          ))
      ),
      ...findSourceImportViolations(
        'forecast/sync must not import artifact internals',
        (file) => isForecastSyncFile(file.path) &&
          !isTestFile(file.path) &&
          file.imports.some((reference) => isForecastArtifactsInternalImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Controls must not import forecast/render',
        (file) => isMapControlRailFile(file.path) &&
          file.imports.some((reference) => isForecastRenderImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'forecast/settings must not import forecast UI, map view, forecast/render, or forecast sync internals',
        (file) => isForecastSettingsFile(file.path) &&
          file.imports.some((reference) => (
            isForecastUiImport(reference.resolvedPath) ||
            reference.resolvedPath.includes('/map/view/') ||
            isForecastRenderImport(reference.resolvedPath) ||
            isForecastSyncImport(reference.resolvedPath)
          ))
      ),
      ...findSourceImportViolations(
        'forecast/selection must stay independent of forecast/settings and units',
        (file) => isForecastSelectionFile(file.path) &&
          !isTestFile(file.path) &&
          file.imports.some((reference) => (
            isForecastSettingsImport(reference.resolvedPath) ||
            isUnitsImport(reference.resolvedPath)
          ))
      ),
      ...findSourceImportViolations(
        'Production map modules must not import forecast/render',
        (file) => isProductionMapFile(file.path) &&
          file.imports.some((reference) => isForecastRenderImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Production map modules must not import forecast place-probe features',
        (file) => isProductionMapFile(file.path) &&
          file.imports.some((reference) => isForecastPlaceProbesImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'forecast/sync must not import MapLibre or forecast/render internals',
        (file) => isForecastSyncFile(file.path) &&
          file.imports.some((reference) => (
            reference.resolvedPath === '/maplibre-gl' ||
            isForecastRenderSubmoduleImport(reference.resolvedPath)
          ))
      ),
      ...findSourceImportViolations(
        'Forecast domain modules must not import AppStatusHost',
        (file) => (isForecastManifestFile(file.path) || isForecastSyncFile(file.path)) &&
          file.imports.some((reference) => reference.resolvedPath.includes('/app/AppStatusHost'))
      ),
      ...findSourceImportViolations(
        'Import forecast/render through its public module',
        (file) => !isForecastRenderFile(file.path) &&
          file.imports.some((reference) => isForecastRenderSubmoduleImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Production imports forecast/sync through its public module',
        (file) => !isForecastSyncFile(file.path) &&
          !isTestFile(file.path) &&
          !file.path.includes('/test/') &&
          !file.path.startsWith('./fixtures/') &&
          file.imports.some((reference) => isForecastSyncSubmoduleImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Import forecast/settings through its public module',
        (file) => !isForecastSettingsFile(file.path) &&
          file.imports.some((reference) => (
            isForecastSettingsSubmoduleImport(reference.resolvedPath) &&
            !(isForecastRenderFile(file.path) && isForecastSettingsContractImport(reference.resolvedPath))
          ))
      ),
      ...findSourceImportViolations(
        'Import forecast/display/legend through its public module',
        (file) => !isForecastLegendFile(file.path) &&
          file.imports.some((reference) => isForecastLegendSubmoduleImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Import forecast/display/palette through its public module',
        (file) => !isForecastPaletteFile(file.path) &&
          file.imports.some((reference) => isForecastPaletteSubmoduleImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Import forecast/catalog through its public module',
        (file) => !isForecastCatalogFile(file.path) &&
          file.imports.some((reference) => (
            isForecastCatalogSubmoduleImport(reference.resolvedPath) &&
            !isForecastCatalogSourceImport(reference.resolvedPath)
          ))
      ),
      ...findSourceImportViolations(
        'Production imports forecast/manifest through its public module',
        (file) => !isForecastManifestFile(file.path) &&
          !isTestFile(file.path) &&
          file.imports.some((reference) => isForecastManifestSubmoduleImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Import forecast/place-probes through its public module',
        (file) => !isForecastPlaceProbesFile(file.path) &&
          file.imports.some((reference) => isForecastPlaceProbesSubmoduleImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Import forecast/frames through its public module',
        (file) => !isForecastFrameFile(file.path) &&
          file.imports.some((reference) => isForecastFrameSubmoduleImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Production imports forecast/artifacts through its public module',
        (file) => !file.path.includes('/forecast/artifacts/') &&
          !isTestFile(file.path) &&
          file.imports.some((reference) => isForecastArtifactsInternalImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Import forecast/selection through its public module',
        (file) => !file.path.includes('/forecast/selection/') &&
          file.imports.some((reference) => isForecastSelectionInternalImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Import forecast/time through its public module',
        (file) => !file.path.includes('/forecast/time/') &&
          file.imports.some((reference) => isForecastTimeInternalImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Only map, render layer helpers, and place probes may import basemap layer contracts',
        (file) => !file.path.includes('/map/') &&
          !file.path.includes('/forecast/render/maplibre/customLayer') &&
          !file.path.includes('/forecast/place-probes/') &&
          !isTestFile(file.path) &&
          file.imports.some((reference) => reference.resolvedPath === '/map/basemap')
      ),
      ...findSourceImportViolations(
        'forecast/render production code must consume forecast windows through frame contracts, not catalog/artifacts/selection/sync/manifest',
        (file) => isForecastRenderFile(file.path) &&
          !isTestFile(file.path) &&
          file.imports.some((reference) => (
            (
              isForecastCatalogImport(reference.resolvedPath) &&
              !isForecastCatalogSourceImport(reference.resolvedPath)
            ) ||
            isForecastArtifactsImport(reference.resolvedPath) ||
            isForecastSelectionImport(reference.resolvedPath) ||
            isForecastSyncImport(reference.resolvedPath) ||
            isForecastManifestImport(reference.resolvedPath)
          ))
      ),
      ...findSourceImportViolations(
        'forecast/render must not expose sync runner APIs',
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
  if (importSource.startsWith('@/')) return stripKnownExtension(`/${importSource.slice(2)}`)
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
  return path.includes('/forecast/render/')
}

function isForecastCatalogFile(path: string): boolean {
  return path.includes('/forecast/catalog/')
}

function isForecastLegendFile(path: string): boolean {
  return path.includes('/forecast/display/legend/')
}

function isForecastPaletteFile(path: string): boolean {
  return path.includes('/forecast/display/palette/')
}

function isForecastDisplayProfilesFile(path: string): boolean {
  return path === '../forecast/display/profiles.ts'
}

function isForecastSettingsFile(path: string): boolean {
  return path.includes('/forecast/settings/')
}

function isForecastSelectionFile(path: string): boolean {
  return path.includes('/forecast/selection/')
}

function isForecastPlaceProbesFile(path: string): boolean {
  return path.includes('/forecast/place-probes/')
}

function isForecastSyncFile(path: string): boolean {
  return path.includes('/forecast/sync/')
}

function isForecastManifestFile(path: string): boolean {
  return path.includes('/forecast/manifest/')
}

function isForecastArtifactsFile(path: string): boolean {
  return path.includes('/forecast/artifacts/')
}

function isForecastCacheFile(path: string): boolean {
  return path.includes('/forecast/cache/')
}

function isForecastFrameFile(path: string): boolean {
  return path.includes('/forecast/frames/')
}

function isForecastRuntimeFile(path: string): boolean {
  return path.includes('/forecast/') && !path.includes('/forecast/ui/')
}

function isUnitsFile(path: string): boolean {
  return path.includes('/forecast/display/units/')
}

function isMapControlRailFile(path: string): boolean {
  return path.includes('/forecast/ui/MapControlRail/')
}

function isMathFile(path: string): boolean {
  return path === '../core/math.ts'
}

function isGeoFile(path: string): boolean {
  return path === '../core/geo.ts'
}

function isForecastModuleImport(path: string): boolean {
  return path.startsWith('/forecast/')
}

function isForecastCatalogImport(path: string): boolean {
  return path === '/forecast/catalog' || isForecastCatalogSubmoduleImport(path)
}

function isForecastLegendImport(path: string): boolean {
  return path === '/forecast/display/legend' || path.includes('/forecast/display/legend/')
}

function isForecastCatalogSubmoduleImport(path: string): boolean {
  return path.includes('/forecast/catalog/')
}

function isForecastCatalogSourceImport(path: string): boolean {
  return path === '/forecast/catalog/source'
}

function isForecastFrameImport(path: string): boolean {
  return path === '/forecast/frames' || isForecastFrameSubmoduleImport(path)
}

function isForecastFrameSubmoduleImport(path: string): boolean {
  return path.includes('/forecast/frames/')
}

function isForecastArtifactsImport(path: string): boolean {
  return path === '/forecast/artifacts' || path.includes('/forecast/artifacts/')
}

function isForecastCacheImport(path: string): boolean {
  return path === '/forecast/cache' || path.includes('/forecast/cache/')
}

function isForecastPlaceProbesImport(path: string): boolean {
  return path === '/forecast/place-probes' || isForecastPlaceProbesSubmoduleImport(path)
}

function isForecastPlaceProbesSubmoduleImport(path: string): boolean {
  return path.includes('/forecast/place-probes/')
}

function isForecastManifestImport(path: string): boolean {
  return path === '/forecast/manifest' || isForecastManifestSubmoduleImport(path)
}

function isForecastManifestSubmoduleImport(path: string): boolean {
  return path.includes('/forecast/manifest/')
}

function isForecastSyncImport(path: string): boolean {
  return path === '/forecast/sync' || path.includes('/forecast/sync/')
}

function isForecastSyncSubmoduleImport(path: string): boolean {
  return path.includes('/forecast/sync/')
}

function isForecastSelectionImport(path: string): boolean {
  return path === '/forecast/selection' || path.includes('/forecast/selection/')
}

function isMapImport(path: string): boolean {
  return path === '/map' || path.includes('/map/')
}

function isUnitsImport(path: string): boolean {
  return path === '/forecast/display/units' || path.includes('/forecast/display/units/')
}

function isProductionMapFile(path: string): boolean {
  return path.includes('/map/') && !/\.(test|spec)\.tsx?$/.test(path)
}

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.tsx?$/.test(path)
}

function isForecastRenderImport(path: string): boolean {
  return path === '/forecast/render' || path.includes('/forecast/render/')
}

function isForecastRenderSubmoduleImport(path: string): boolean {
  return path.includes('/forecast/render/')
}

function isForecastSettingsImport(path: string): boolean {
  return path === '/forecast/settings' || isForecastSettingsSubmoduleImport(path)
}

function isForecastSettingsSubmoduleImport(path: string): boolean {
  return path.includes('/forecast/settings/')
}

function isForecastLegendSubmoduleImport(path: string): boolean {
  return path.includes('/forecast/display/legend/')
}

function isForecastPaletteSubmoduleImport(path: string): boolean {
  return path.includes('/forecast/display/palette/')
}

function isForecastSettingsContractImport(path: string): boolean {
  return path === '/forecast/settings/settings'
}

function isForecastUiImport(path: string): boolean {
  return path === '/forecast/ui' || path.includes('/forecast/ui/')
}

function isAppImport(path: string): boolean {
  return path === '/app' || path.includes('/app/')
}

function isMapProbeImport(path: string): boolean {
  return path === '/map-probe' || path.includes('/map-probe/')
}

function isForecastArtifactsInternalImport(path: string): boolean {
  return path.includes('/forecast/artifacts/loader') ||
    path.includes('/forecast/artifacts/payloadCache') ||
    path.includes('/forecast/artifacts/payload')
}

function isForecastSelectionInternalImport(path: string): boolean {
  return path.includes('/forecast/selection/ForecastSelectionContext') ||
    path.includes('/forecast/selection/ForecastSelectionProvider')
}

function isForecastTimeInternalImport(path: string): boolean {
  return path.includes('/forecast/time/ForecastTimeContext') ||
    path.includes('/forecast/time/ForecastTimeProvider') ||
    path.includes('/forecast/time/format') ||
    path.includes('/forecast/time/state') ||
    path.includes('/forecast/time/time')
}
