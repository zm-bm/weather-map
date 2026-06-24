import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'

const FRAMES = [
  {
    id: '000',
    lead_hours: 0,
    valid_at: '2026-06-24T12:00:00Z',
  },
] as const

const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axm3qkAAAAASUVORK5CYII=',
  'base64'
)
const ATTRIBUTION = '.maplibregl-ctrl-attrib-inner'

test('loads satellite imagery only for sparse weather layers', async ({ page }) => {
  let satelliteTileRequests = 0

  await page.route('**/manifests/index.json', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createManifest()),
    })
  })

  await page.route('**/runs/gfs/satellite-test/payloads/**', async (route) => {
    const payloadFile = new URL(route.request().url()).pathname.split('/').at(-1)
    const payload = payloadFile === 'tmp_surface.i8.bin'
      ? [24, 26, 28, 30]
      : payloadFile === 'prate_surface.i8.bin'
        ? [0, 12, 0, 24]
        : null

    if (!payload) {
      await route.fulfill({ status: 404 })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      body: Buffer.from(payload),
    })
  })

  await page.route('**/BlueMarble_NextGeneration/**', async (route) => {
    satelliteTileRequests += 1
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: TILE_PNG,
    })
  })
  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })
  await page.route('**/pmtiles/**', async (route) => {
    await route.abort()
  })

  await page.goto('/?layer=temperature')
  await expect(page.getByRole('region', { name: 'Weather maps' })).toContainText('Temperature')
  await expect(page.getByRole('region', { name: 'Temperature legend' })).toBeVisible()
  await expect(page.getByText(/Forecast (Load|Startup) Failed/)).toHaveCount(0)
  await expect(page.locator(ATTRIBUTION)).not.toContainText('NASA GIBS')
  await page.waitForTimeout(1000)
  expect(satelliteTileRequests).toBe(0)

  await page.goto('/?layer=precipitation_rate')
  await expect(page.getByRole('region', { name: 'Weather maps' })).toContainText('Precipitation Rate')
  await expect(page.getByRole('region', { name: 'Precipitation Rate legend' })).toBeVisible()
  await expect(page.getByText(/Forecast (Load|Startup) Failed/)).toHaveCount(0)
  await expect(page.locator(ATTRIBUTION)).toContainText('NASA GIBS / ESDIS')
  await expect.poll(() => satelliteTileRequests, {
    message: 'expected sparse precipitation layer to request NASA GIBS tiles',
  }).toBeGreaterThan(0)
})

function createManifest() {
  return {
    schema: 'weather-map.manifest-index',
    schema_version: 3,
    generated_at: '2026-06-24T12:05:00Z',
    catalog_version: 'forecast-catalog-v1',
    payload_contract: 'field-binary-v2',
    datasets: {
      gfs: {
        label: 'GFS',
        latest: {
          run: {
            cycle: '2026062412',
            run_id: 'satellite-test',
            payload_root: 'runs/gfs/satellite-test/payloads',
            generated_at: '2026-06-24T12:05:00Z',
            revision: 'satellite-background-playwright',
          },
          frames: FRAMES,
          artifacts: {
            tmp_surface: createScalarArtifact({
              id: 'tmp_surface',
              parameter: 'tmp',
              units: 'C',
              payloadFile: 'tmp_surface.i8.bin',
              encoding: {
                id: 'tmp_surface_i8_temp_c_piecewise_v1',
                format: 'temp-c-piecewise-i8-v1',
                dtype: 'int8',
                byte_order: 'none',
                nodata: -128,
              },
            }),
            prate_surface: createScalarArtifact({
              id: 'prate_surface',
              parameter: 'prate',
              units: 'mm/hr',
              payloadFile: 'prate_surface.i8.bin',
              encoding: {
                id: 'prate_surface_i8_0p1mmhr_v1',
                format: 'linear-i8-v1',
                dtype: 'int8',
                byte_order: 'none',
                nodata: -128,
                scale: 0.1,
                offset: 0,
                decode_formula: 'value = stored * scale + offset',
                finite_value_range: {
                  min: 0,
                  max: 30,
                },
              },
            }),
          },
        },
      },
    },
    layers: {
      temperature: createAvailableLayer('tmp_surface'),
      precipitation_rate: createAvailableLayer('prate_surface'),
    },
  }
}

function createScalarArtifact(args: {
  id: string
  parameter: string
  units: string
  payloadFile: string
  encoding: Record<string, unknown>
}) {
  return {
    id: args.id,
    kind: 'scalar',
    units: args.units,
    parameter: args.parameter,
    level: 'surface',
    components: ['value'],
    grid: {
      id: `${args.id}_test_grid`,
      crs: 'EPSG:4326',
      nx: 2,
      ny: 2,
      lon0: -120,
      lat0: 50,
      dx: 30,
      dy: -30,
      origin: 'cell_center',
      layout: 'row_major',
      x_wrap: 'none',
      y_mode: 'none',
    },
    byte_length: 4,
    payload_file: args.payloadFile,
    encoding: args.encoding,
  }
}

function createAvailableLayer(artifactId: string) {
  return {
    datasets: {
      gfs: {
        state: 'available',
        support: 'native',
        required_artifacts: [artifactId],
        optional_artifacts: [],
      },
    },
  }
}
