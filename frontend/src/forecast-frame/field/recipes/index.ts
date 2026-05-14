import type { ArtifactLoader } from '../../../forecast-artifacts'
import type { DerivedLayerSource } from '../../../forecast-catalog'
import type { FieldSourceData } from '../source'
import { loadWindSpeedFieldSource } from './windSpeed'

export async function loadDerivedFieldRecipe(args: {
  artifacts: ArtifactLoader
  hourToken: string
  source: DerivedLayerSource
}): Promise<FieldSourceData> {
  if (args.source.recipe === 'wind-speed') {
    return loadWindSpeedFieldSource(args)
  }

  throw new Error(`Unsupported derived field recipe: ${args.source.recipe}`)
}
