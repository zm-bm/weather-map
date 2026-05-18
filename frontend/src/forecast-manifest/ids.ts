import type { Brand } from '../types'

export type ArtifactId = Brand<string, 'ArtifactId'>
export type VectorArtifactId = ArtifactId

export function asVectorArtifactId(value: string): VectorArtifactId {
  return value as ArtifactId
}

export function asArtifactId(value: string): ArtifactId {
  return value as ArtifactId
}
