export function createScalarPayloadFixture(values: number[]): ArrayBuffer {
  return new Int16Array(values).buffer
}

export function createVectorPayloadFixture(
  uValues: number[],
  vValues: number[]
): ArrayBuffer {
  const u = new Int8Array(uValues)
  const v = new Int8Array(vValues)
  const payload = new Uint8Array(u.byteLength + v.byteLength)
  payload.set(new Uint8Array(u.buffer), 0)
  payload.set(new Uint8Array(v.buffer), u.byteLength)
  return payload.buffer
}
