import { manifestSchema, type Manifest } from './schema'

export function parseManifest(value: unknown): Manifest {
  return manifestSchema.parse(value)
}
