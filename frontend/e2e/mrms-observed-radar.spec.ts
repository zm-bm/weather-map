import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'

const FRAMES = [
  {
    id: '20260611000238',
    lead_hours: 0,
    valid_at: '2026-06-11T00:02:38Z',
  },
  {
    id: '20260611000338',
    lead_hours: 0,
    valid_at: '2026-06-11T00:03:38Z',
  },
  {
    id: '20260611000439',
    lead_hours: 0,
    valid_at: '2026-06-11T00:04:39Z',
  },
] as const

const INITIAL_FRAME_ID = FRAMES[FRAMES.length - 1].id
const COMPOSITE_REFLECTIVITY_ARTIFACT_ID = 'observed_radar_composite_reflectivity'
const PAYLOAD_FILE = `${COMPOSITE_REFLECTIVITY_ARTIFACT_ID}.i8.bin`

const payloadByFrameId: Record<string, readonly number[]> = {
  '20260611000238': [8, 12, 16, 20],
  '20260611000338': [18, 22, 26, 30],
  '20260611000439': [28, 32, 36, 40],
}

test('loads mocked MRMS observed radar and advances playback through rolling payloads', async ({ page }) => {
  const payloadPaths: string[] = []
  const payloadPathsAfterPlay: string[] = []
  let playClicked = false
  let releaseHeldPayloads = () => {}
  const playStarted = new Promise<void>((resolve) => {
    releaseHeldPayloads = resolve
  })

  await page.addInitScript(() => {
    Date.now = () => Date.parse('2026-06-11T00:04:50Z')
  })

  await page.route('**/manifests/index.json', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createMrmsManifest()),
    })
  })

  await page.route('**/runs/mrms/rolling/payloads/**', async (route) => {
    const url = new URL(route.request().url())
    const pathParts = url.pathname.split('/')
    const frameId = pathParts[pathParts.length - 2] ?? ''
    const payloadFile = pathParts[pathParts.length - 1] ?? ''
    const payload = payloadByFrameId[frameId]

    payloadPaths.push(url.pathname)
    if (frameId !== INITIAL_FRAME_ID && !playClicked) {
      await playStarted
    }
    if (playClicked) payloadPathsAfterPlay.push(url.pathname)

    if (payload == null || payloadFile !== PAYLOAD_FILE) {
      await route.fulfill({ status: 404 })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      body: Buffer.from(payload),
    })
  })

  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })
  await page.route('**/pmtiles/**', async (route) => {
    await route.abort()
  })

  await page.goto('/?layer=observed_radar_composite_reflectivity')

  await expect(page.getByRole('region', { name: 'Weather maps' })).toContainText('Observed Radar Composite')
  await expect(page.getByRole('radio', { name: 'MRMS' })).toBeChecked()
  await expect(page.getByRole('region', { name: 'Observed Radar Composite legend' })).toBeVisible()
  await expect(page.getByText(/Forecast (Load|Startup) Failed/)).toHaveCount(0)

  await expect.poll(() => payloadPaths.length, {
    message: 'expected initial MRMS rolling payload request',
  }).toBeGreaterThan(0)
  expect(payloadPaths).toContain(`/runs/mrms/rolling/payloads/${INITIAL_FRAME_ID}/${PAYLOAD_FILE}`)

  const validTime = page.getByRole('slider', { name: 'Forecast time' })
  await expect(validTime).toBeVisible()
  const initialValidTimeText = await validTime.getAttribute('aria-valuetext')

  playClicked = true
  await page.getByRole('button', { name: 'Play forecast timeline' }).click()
  releaseHeldPayloads()

  await expect(page.getByRole('button', { name: 'Pause playback' })).toBeVisible()
  await expect.poll(async () => await validTime.getAttribute('aria-valuetext'), {
    message: 'expected playback to advance the displayed valid time',
  }).not.toBe(initialValidTimeText)
  await expect.poll(() => payloadPathsAfterPlay.length, {
    message: 'expected playback to load a later MRMS frame payload',
  }).toBeGreaterThan(0)
  expect(new Set(payloadPaths.map(frameIdFromPayloadPath)).size).toBeGreaterThan(1)
})

function createMrmsManifest() {
  return {
    schema: 'weather-map.manifest-index',
    schema_version: 3,
    generated_at: '2026-06-11T00:05:00Z',
    catalog_version: 'forecast-catalog-v1',
    payload_contract: 'field-binary-v2',
    datasets: {
      mrms: {
        label: 'MRMS',
        latest: {
          run: {
            cycle: '2026061100',
            run_id: 'rolling-20260611000439',
            payload_root: 'runs/mrms/rolling/payloads',
            generated_at: '2026-06-11T00:05:00Z',
            revision: 'mrms-rolling-playwright',
          },
          frames: FRAMES,
          artifacts: {
            [COMPOSITE_REFLECTIVITY_ARTIFACT_ID]: createReflectivityArtifact({
              id: COMPOSITE_REFLECTIVITY_ARTIFACT_ID,
              parameter: 'MergedReflectivityQCComposite',
              level: 'composite',
              payloadFile: `${COMPOSITE_REFLECTIVITY_ARTIFACT_ID}.i8.bin`,
            }),
          },
        },
      },
    },
    layers: {
      [COMPOSITE_REFLECTIVITY_ARTIFACT_ID]: createAvailableLayer(COMPOSITE_REFLECTIVITY_ARTIFACT_ID),
    },
  }
}

function createReflectivityArtifact(args: {
  id: string
  parameter: string
  level: string
  payloadFile?: string
}) {
  return {
    id: args.id,
    kind: 'scalar',
    units: 'dBZ',
    parameter: args.parameter,
    level: args.level,
    components: ['value'],
    grid: {
      id: 'mrms_conus_0p02',
      crs: 'EPSG:4326',
      nx: 2,
      ny: 2,
      lon0: -100,
      lat0: 40,
      dx: 0.02,
      dy: -0.02,
      origin: 'cell_center',
      layout: 'row_major',
      x_wrap: 'none',
      y_mode: 'none',
    },
    byte_length: 4,
    payload_file: args.payloadFile ?? PAYLOAD_FILE,
    encoding: {
      id: `${args.id}.linear-i8`,
      format: 'linear-i8-v1',
      dtype: 'int8',
      byte_order: 'none',
      nodata: -128,
      scale: 1,
      offset: 0,
      decode_formula: 'value = stored * scale + offset',
      finite_value_range: {
        min: 0,
        max: 75,
      },
    },
  }
}

function createAvailableLayer(artifactId: string) {
  return {
    datasets: {
      mrms: {
        state: 'available',
        support: 'native',
        required_artifacts: [artifactId],
        optional_artifacts: [],
      },
    },
  }
}

function frameIdFromPayloadPath(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 2] ?? ''
}
