type Brand<T, B extends string> = T & { readonly __brand: B }

export type NonEmptyArray<T> = [T, ...T[]]
export type ProductId = Brand<string, 'ProductId'>
export type VectorProductId = ProductId

export function asVectorProductId(value: string): VectorProductId {
  return value as ProductId
}

export function asProductId(value: string): ProductId {
  return value as ProductId
}
