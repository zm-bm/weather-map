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
        'forecast-render may only import the pure forecast-settings contract',
        (file) => isForecastRenderFile(file.path) &&
          file.imports.some((reference) => (
            isForecastSettingsImport(reference.resolvedPath) &&
            !isForecastSettingsContractImport(reference.resolvedPath)
          ))
      ),
      ...findSourceImportViolations(
        'units must stay independent of app and forecast modules',
        (file) => isUnitsFile(file.path) &&
          file.imports.some((reference) => (
            isForecastModuleImport(reference.resolvedPath) ||
            isComponentsImport(reference.resolvedPath) ||
            isMapImport(reference.resolvedPath) ||
            reference.resolvedPath === '/react' ||
            reference.resolvedPath.includes('/test/')
          ))
      ),
      ...findSourceImportViolations(
        'forecast-legend must stay independent of app, catalog, data, map, render, and sync modules',
        (file) => isForecastLegendFile(file.path) &&
          file.imports.some((reference) => (
            isComponentsImport(reference.resolvedPath) ||
            isForecastCatalogImport(reference.resolvedPath) ||
            isForecastDataLoadersImport(reference.resolvedPath) ||
            isForecastDataTargetsImport(reference.resolvedPath) ||
            isForecastDataImport(reference.resolvedPath) ||
            isForecastManifestImport(reference.resolvedPath) ||
            isForecastRenderImport(reference.resolvedPath) ||
            isForecastSyncImport(reference.resolvedPath) ||
            isMapImport(reference.resolvedPath) ||
            isUnitsImport(reference.resolvedPath)
          ))
      ),
      ...findSourceImportViolations(
        'forecast-palette must stay independent of app and forecast runtime modules',
        (file) => isForecastPaletteFile(file.path) &&
          file.imports.some((reference) => (
            isComponentsImport(reference.resolvedPath) ||
            isForecastCatalogImport(reference.resolvedPath) ||
            isForecastDataLoadersImport(reference.resolvedPath) ||
            isForecastDataTargetsImport(reference.resolvedPath) ||
            isForecastDataImport(reference.resolvedPath) ||
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
        'forecast-place-probes must stay independent of app, component, render, sync, settings, catalog, and map internals',
        (file) => isForecastPlaceProbesFile(file.path) &&
          !isTestFile(file.path) &&
          file.imports.some((reference) => (
            isComponentsImport(reference.resolvedPath) ||
            isForecastCatalogImport(reference.resolvedPath) ||
            isForecastRenderImport(reference.resolvedPath) ||
            isForecastSettingsImport(reference.resolvedPath) ||
            isForecastSyncImport(reference.resolvedPath) ||
            (
              isMapImport(reference.resolvedPath) &&
              reference.resolvedPath !== '/map/basemap'
            ) ||
            reference.resolvedPath === '/react'
          ))
      ),
      ...findSourceImportViolations(
        'forecast-manifest must not import forecast-catalog',
        (file) => isForecastManifestFile(file.path) &&
          file.imports.some((reference) => isForecastCatalogImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'forecast-probe must stay sampling-only',
        (file) => isForecastProbeFile(file.path) &&
          !isTestFile(file.path) &&
          file.imports.some((reference) => (
            isComponentsImport(reference.resolvedPath) ||
            isForecastCatalogImport(reference.resolvedPath) ||
            isForecastPlaceProbesImport(reference.resolvedPath) ||
            isForecastRenderImport(reference.resolvedPath) ||
            isForecastSelectionImport(reference.resolvedPath) ||
            isForecastSettingsImport(reference.resolvedPath) ||
            isForecastSyncImport(reference.resolvedPath) ||
            isMapImport(reference.resolvedPath) ||
            isUnitsImport(reference.resolvedPath) ||
            reference.resolvedPath === '/react'
          ))
      ),
      ...findSourceImportViolations(
        'forecast-data must stay independent of React, app, catalog, map, render, sync, settings, and probe modules',
        (file) => isForecastDataFile(file.path) &&
          !isTestFile(file.path) &&
          file.imports.some((reference) => (
            isComponentsImport(reference.resolvedPath) ||
            isForecastCatalogImport(reference.resolvedPath) ||
            isForecastPlaceProbesImport(reference.resolvedPath) ||
            isForecastProbeImport(reference.resolvedPath) ||
            isForecastRenderImport(reference.resolvedPath) ||
            isForecastSettingsImport(reference.resolvedPath) ||
            isForecastSyncImport(reference.resolvedPath) ||
            isMapImport(reference.resolvedPath) ||
            reference.resolvedPath === '/react'
          ))
      ),
      ...findSourceImportViolations(
        'forecast-data-targets must stay independent of React, artifacts, data loaders, data orchestration, render, sync, settings, map, and probe modules',
        (file) => isForecastDataTargetsFile(file.path) &&
          !isTestFile(file.path) &&
          file.imports.some((reference) => (
            isComponentsImport(reference.resolvedPath) ||
            isForecastArtifactsImport(reference.resolvedPath) ||
            isForecastDataLoadersImport(reference.resolvedPath) ||
            isForecastDataImport(reference.resolvedPath) ||
            isForecastPlaceProbesImport(reference.resolvedPath) ||
            isForecastProbeImport(reference.resolvedPath) ||
            isForecastRenderImport(reference.resolvedPath) ||
            isForecastSettingsImport(reference.resolvedPath) ||
            isForecastSyncImport(reference.resolvedPath) ||
            isMapImport(reference.resolvedPath) ||
            reference.resolvedPath === '/react'
          ))
      ),
      ...findSourceImportViolations(
        'forecast-data-loaders must stay independent of React, catalog, data orchestration, render, sync, settings, map, and probe modules',
        (file) => isForecastDataLoadersFile(file.path) &&
          !isTestFile(file.path) &&
          file.imports.some((reference) => (
            isComponentsImport(reference.resolvedPath) ||
            isForecastCatalogImport(reference.resolvedPath) ||
            isForecastDataImport(reference.resolvedPath) ||
            isForecastPlaceProbesImport(reference.resolvedPath) ||
            isForecastProbeImport(reference.resolvedPath) ||
            isForecastRenderImport(reference.resolvedPath) ||
            isForecastSettingsImport(reference.resolvedPath) ||
            isForecastSyncImport(reference.resolvedPath) ||
            isMapImport(reference.resolvedPath) ||
            reference.resolvedPath === '/react'
          ))
      ),
      ...findSourceImportViolations(
        'Controls must not import forecast-render',
        (file) => isMapControlRailFile(file.path) &&
          file.imports.some((reference) => isForecastRenderImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'forecast-settings must not import components, map view, forecast-render, or forecast sync internals',
        (file) => isForecastSettingsFile(file.path) &&
          file.imports.some((reference) => (
            isComponentsImport(reference.resolvedPath) ||
            reference.resolvedPath.includes('/map/view/') ||
            isForecastRenderImport(reference.resolvedPath) ||
            isForecastSyncImport(reference.resolvedPath)
          ))
      ),
      ...findSourceImportViolations(
        'Production map modules must not import forecast-render',
        (file) => isProductionMapFile(file.path) &&
          file.imports.some((reference) => isForecastRenderImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Production map modules must not import forecast probe features',
        (file) => isProductionMapFile(file.path) &&
          file.imports.some((reference) => (
            isForecastPlaceProbesImport(reference.resolvedPath) ||
            isForecastProbeImport(reference.resolvedPath)
          ))
      ),
      ...findSourceImportViolations(
        'forecast-sync must not import MapLibre, forecast-probe, or forecast-render internals',
        (file) => isForecastSyncFile(file.path) &&
          file.imports.some((reference) => (
            reference.resolvedPath === '/maplibre-gl' ||
            isForecastProbeImport(reference.resolvedPath) ||
            isForecastRenderSubmoduleImport(reference.resolvedPath)
          ))
      ),
      ...findSourceImportViolations(
        'Forecast domain modules must not import AppStatusHost',
        (file) => (isForecastManifestFile(file.path) || isForecastSyncFile(file.path)) &&
          file.imports.some((reference) => reference.resolvedPath.includes('/components/AppStatusHost'))
      ),
      ...findSourceImportViolations(
        'Import forecast-render through its public module',
        (file) => !isForecastRenderFile(file.path) &&
          file.imports.some((reference) => isForecastRenderSubmoduleImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Import forecast-sync through its public module',
        (file) => !isForecastSyncFile(file.path) &&
          file.imports.some((reference) => isForecastSyncSubmoduleImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Import forecast-settings through its public module',
        (file) => !isForecastSettingsFile(file.path) &&
          file.imports.some((reference) => (
            isForecastSettingsSubmoduleImport(reference.resolvedPath) &&
            !(isForecastRenderFile(file.path) && isForecastSettingsContractImport(reference.resolvedPath))
          ))
      ),
      ...findSourceImportViolations(
        'Import forecast-legend through its public module',
        (file) => !isForecastLegendFile(file.path) &&
          file.imports.some((reference) => isForecastLegendSubmoduleImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Import forecast-palette through its public module',
        (file) => !isForecastPaletteFile(file.path) &&
          file.imports.some((reference) => isForecastPaletteSubmoduleImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Import forecast-catalog through its public module',
        (file) => !isForecastCatalogFile(file.path) &&
          file.imports.some((reference) => isForecastCatalogSubmoduleImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Import forecast-probe through its public module',
        (file) => !file.path.includes('/forecast-probe/') &&
          file.imports.some((reference) => isForecastProbeSubmoduleImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Import forecast-place-probes through its public module',
        (file) => !isForecastPlaceProbesFile(file.path) &&
          file.imports.some((reference) => isForecastPlaceProbesSubmoduleImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Import forecast-data internals through forecast-data public modules',
        (file) => !file.path.includes('/forecast-data/') &&
          file.imports.some((reference) => isForecastDataInternalImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Import forecast-data-targets through its public module',
        (file) => !isForecastDataTargetsFile(file.path) &&
          file.imports.some((reference) => isForecastDataTargetsSubmoduleImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Only forecast-data may import forecast-data-loaders in production',
        (file) => !isForecastDataLoadersFile(file.path) &&
          !isForecastDataFile(file.path) &&
          !isTestFile(file.path) &&
          file.imports.some((reference) => isForecastDataLoadersImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Import forecast-data-loaders internals through forecast-data-loaders public modules',
        (file) => !isForecastDataLoadersFile(file.path) &&
          file.imports.some((reference) => isForecastDataLoadersSubmoduleImport(reference.resolvedPath))
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
        'Import forecast-time through its public module',
        (file) => !file.path.includes('/forecast-time/') &&
          file.imports.some((reference) => isForecastTimeInternalImport(reference.resolvedPath))
      ),
      ...findSourceImportViolations(
        'Only map, render layer helpers, and place probes may import basemap layer contracts',
        (file) => !file.path.includes('/map/') &&
          !file.path.includes('/forecast-render/layer') &&
          !file.path.includes('/forecast-place-probes/') &&
          !isTestFile(file.path) &&
          file.imports.some((reference) => reference.resolvedPath === '/map/basemap')
      ),
      ...findSourceImportViolations(
        'forecast-render must not import forecast-data loader modules or APIs',
        (file) => isForecastRenderFile(file.path) && (
          file.imports.some((reference) => (
            isForecastDataInternalImport(reference.resolvedPath) ||
            isForecastDataLoadersImport(reference.resolvedPath)
          )) ||
          /\b(createForecastDataRequest|createArtifactLoader)\b/
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

function isForecastCatalogFile(path: string): boolean {
  return path.includes('/forecast-catalog/')
}

function isForecastLegendFile(path: string): boolean {
  return path.includes('/forecast-legend/')
}

function isForecastPaletteFile(path: string): boolean {
  return path.includes('/forecast-palette/')
}

function isForecastSettingsFile(path: string): boolean {
  return path.includes('/forecast-settings/')
}

function isForecastPlaceProbesFile(path: string): boolean {
  return path.includes('/forecast-place-probes/')
}

function isForecastSyncFile(path: string): boolean {
  return path.includes('/forecast-sync/')
}

function isForecastManifestFile(path: string): boolean {
  return path.includes('/forecast-manifest/')
}

function isForecastDataFile(path: string): boolean {
  return path.includes('/forecast-data/')
}

function isForecastDataTargetsFile(path: string): boolean {
  return path.includes('/forecast-data-targets/')
}

function isForecastDataLoadersFile(path: string): boolean {
  return path.includes('/forecast-data-loaders/')
}

function isForecastProbeFile(path: string): boolean {
  return path.includes('/forecast-probe/')
}

function isUnitsFile(path: string): boolean {
  return path.includes('/units/')
}

function isMapControlRailFile(path: string): boolean {
  return path.includes('/components/MapControlRail/')
}

function isForecastModuleImport(path: string): boolean {
  return path.startsWith('/forecast-')
}

function isForecastCatalogImport(path: string): boolean {
  return path === '/forecast-catalog' || isForecastCatalogSubmoduleImport(path)
}

function isForecastLegendImport(path: string): boolean {
  return path === '/forecast-legend' || path.includes('/forecast-legend/')
}

function isForecastCatalogSubmoduleImport(path: string): boolean {
  return path.includes('/forecast-catalog/')
}

function isForecastDataImport(path: string): boolean {
  return path === '/forecast-data' || path.includes('/forecast-data/')
}

function isForecastArtifactsImport(path: string): boolean {
  return path === '/forecast-artifacts' || path.includes('/forecast-artifacts/')
}

function isForecastDataTargetsImport(path: string): boolean {
  return path === '/forecast-data-targets' || isForecastDataTargetsSubmoduleImport(path)
}

function isForecastDataTargetsSubmoduleImport(path: string): boolean {
  return path.includes('/forecast-data-targets/')
}

function isForecastDataLoadersImport(path: string): boolean {
  return path === '/forecast-data-loaders' || isForecastDataLoadersSubmoduleImport(path)
}

function isForecastDataLoadersSubmoduleImport(path: string): boolean {
  return path.includes('/forecast-data-loaders/')
}

function isForecastPlaceProbesImport(path: string): boolean {
  return path === '/forecast-place-probes' || isForecastPlaceProbesSubmoduleImport(path)
}

function isForecastPlaceProbesSubmoduleImport(path: string): boolean {
  return path.includes('/forecast-place-probes/')
}

function isForecastManifestImport(path: string): boolean {
  return path === '/forecast-manifest' || path.includes('/forecast-manifest/')
}

function isForecastSyncImport(path: string): boolean {
  return path === '/forecast-sync' || path.includes('/forecast-sync/')
}

function isForecastSyncSubmoduleImport(path: string): boolean {
  return path.includes('/forecast-sync/')
}

function isForecastSelectionImport(path: string): boolean {
  return path === '/forecast-selection' || path.includes('/forecast-selection/')
}

function isMapImport(path: string): boolean {
  return path === '/map' || path.includes('/map/')
}

function isUnitsImport(path: string): boolean {
  return path === '/units' || path.includes('/units/')
}

function isProductionMapFile(path: string): boolean {
  return path.includes('/map/') && !/\.(test|spec)\.tsx?$/.test(path)
}

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.tsx?$/.test(path)
}

function isForecastRenderImport(path: string): boolean {
  return path === '/forecast-render' || path.includes('/forecast-render/')
}

function isForecastRenderSubmoduleImport(path: string): boolean {
  return path.includes('/forecast-render/')
}

function isForecastSettingsImport(path: string): boolean {
  return path === '/forecast-settings' || isForecastSettingsSubmoduleImport(path)
}

function isForecastSettingsSubmoduleImport(path: string): boolean {
  return path.includes('/forecast-settings/')
}

function isForecastLegendSubmoduleImport(path: string): boolean {
  return path.includes('/forecast-legend/')
}

function isForecastPaletteSubmoduleImport(path: string): boolean {
  return path.includes('/forecast-palette/')
}

function isForecastSettingsContractImport(path: string): boolean {
  return path === '/forecast-settings/settings'
}

function isComponentsImport(path: string): boolean {
  return path === '/components' || path.includes('/components/')
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
  return path.includes('/forecast-data/')
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

function isForecastTimeInternalImport(path: string): boolean {
  return path.includes('/forecast-time/ForecastTimeContext') ||
    path.includes('/forecast-time/ForecastTimeProvider') ||
    path.includes('/forecast-time/format') ||
    path.includes('/forecast-time/state') ||
    path.includes('/forecast-time/time') ||
    path.includes('/forecast-time/types')
}
