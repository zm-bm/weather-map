export function createCycleManifestPayloadFixture(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    version: 4,
    contract: 'forecast-binary-v2',
    cycle: '2026041312',
    generated_at: '2026-04-13T12:00:00Z',
    revision: 'rev',
    forecast_hours: ['000'],
    scalar_variables: ['tmp_surface'],
    vector_variables: ['wind10m_uv'],
    grids: {
      g0: {
        crs: 'EPSG:4326',
        nx: 2,
        ny: 2,
        lon0: -180,
        lat0: 90,
        dx: 0.25,
        dy: -0.25,
        origin: 'cell_center',
        layout: 'row_major',
        x_wrap: 'repeat',
        y_mode: 'clamp',
      },
    },
    encodings: {
      e0: {
        format: 'scalar-i16-linear-v1',
        dtype: 'int16',
        byte_order: 'little',
        nodata: -32768,
        scale: 0.01,
        offset: 0,
        decode_formula: 'value = stored * scale + offset',
      },
      wind10m_uv_vector_i8_v1: {
        format: 'uv-i8-q0p5-v1',
        dtype: 'int8',
        byte_order: 'none',
        scale: 0.5,
        offset: 0,
        decode_formula: 'value = stored * scale + offset',
        components: ['u', 'v'],
        component_count: 2,
        component_order: 'u_then_v',
      },
    },
    variable_meta: {
      tmp_surface: {
        kind: 'scalar',
        units: 'C',
        parameter: 'tmp',
        level: 'surface',
        valid_min: -45,
        valid_max: 50,
        grid_id: 'g0',
        encoding_id: 'e0',
      },
      wind10m_uv: {
        kind: 'vector',
        units: 'm/s',
        parameter: 'wind_uv',
        level: '10m_above_ground',
        valid_min: -64,
        valid_max: 63.5,
        grid_id: 'g0',
        encoding_id: 'wind10m_uv_vector_i8_v1',
      },
    },
    frames: {
      '000': {
        tmp_surface: {
          path: 'fields/2026041312/000/tmp_surface.scalar.i16.bin',
          byte_length: 8,
          sha256: 'a',
        },
        wind10m_uv: {
          path: 'fields/2026041312/000/wind10m_uv.vector.i8.bin',
          byte_length: 8,
          sha256: 'b',
        },
      },
    },
    ...overrides,
  }
}

export function createLatestManifestPayloadFixture(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    cycle: '2026041312',
    generated_at: '2026-04-13T12:00:00Z',
    revision: 'rev',
    ...overrides,
  }
}
