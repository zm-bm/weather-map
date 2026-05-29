export function createScalarPayloadFixture(values: number[]): ArrayBuffer {
  return new Int8Array(values).buffer
}

export function createVectorPayloadFixture(
  uValues: number[],
  vValues: number[],
  ...extraComponentValues: number[][]
): ArrayBuffer {
  const components = [uValues, vValues, ...extraComponentValues].map((values) => new Int8Array(values))
  const payload = new Uint8Array(components.reduce((total, component) => total + component.byteLength, 0))
  let offset = 0
  for (const component of components) {
    payload.set(new Uint8Array(component.buffer), offset)
    offset += component.byteLength
  }
  return payload.buffer
}
