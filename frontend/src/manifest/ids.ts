type Brand<T, B extends string> = T & { readonly __brand: B }

export type NonEmptyArray<T> = [T, ...T[]]
export type ArtifactId = Brand<string, 'ArtifactId'>
export type VectorArtifactId = ArtifactId

export function asVectorArtifactId(value: string): VectorArtifactId {
  return value as ArtifactId
}

export function asArtifactId(value: string): ArtifactId {
  return value as ArtifactId
}
