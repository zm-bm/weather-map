import type { ArtifactLoader } from '../../../forecast-artifacts'
import type { ForecastDerivedFieldDataSource } from '../../../forecast-data-targets'
import type { FieldSourceData } from '../source'
import { loadWindSpeedFieldSource } from './windSpeed'

export async function loadDerivedFieldRecipe(args: {
  artifacts: ArtifactLoader
  hourToken: string
  source: ForecastDerivedFieldDataSource
}): Promise<FieldSourceData> {
  if (args.source.recipe === 'wind-speed') {
    return loadWindSpeedFieldSource(args)
  }

  throw new Error(`Unsupported derived field recipe: ${args.source.recipe}`)
}
