export const PLACE_PROBE_POLICY = {
  bounds: {
    paddingRatio: 0.2,
  },
  grid: {
    maxColumns: 10,
    maxRows: 8,
    minColumns: 4,
    minRows: 4,
    worldSouth: -90,
    worldWest: -180,
  },
  labels: {
    areaPx: 28_000,
    defaultLimit: 30,
    maxLimit: 72,
  },
  population: {
    major: 1_000_000,
    mid: 250_000,
  },
  zoom: {
    local: 5.25,
    mid: 4.25,
    min: 2.8,
  },
} as const
