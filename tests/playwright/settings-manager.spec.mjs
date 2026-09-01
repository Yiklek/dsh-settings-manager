/**
 * Playwright e2e — against a live DSH web instance (Edge).
 * Verifies the plugin is actually loaded: the "设置编排" section is present
 * near the top of the Settings nav, its panel renders one row per section,
 * toggling a switch removes/restores a section from the nav, and reorder /
 * reset-all work live.
 *
 * The manager section is forced to order 1 (near the top) so the nav never
 * needs scrolling to reach it.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

// First-run / onboarding dialogs can appear in a fresh context. Dismiss them
// the same way the dsh-web-profile CI smoke does: repeatedly dismiss whatever
// modal is present (click the [aria-hidden] mask, tap known dismiss buttons),
// then retry opening Settings until it succeeds.
const DISMISS_LABELS = ['继续', '稍后配置', '知道了', '关闭此提示']

/**
 * Resolve the dsh connection URL to establish the browser session before the
 * test navigates. dsh boot prints a token-bearing root URL
 * (`http://host:port/?token=...`); visiting it exchanges the token for an
 * authority-bound cookie and redirects to the clean root. The URL comes from
 * `DSH_TOKEN_URL` when the caller knows it directly; otherwise it is parsed
 * from the dsh boot log (`DSH_BOOT_LOG`, defaulting to the CI path). Returns
 * `undefined` when no token URL is available (deployments without the root
 * gate), in which case the test navigates straight to "/".
 */
function tokenUrl() {
  if (process.env.DSH_TOKEN_URL && process.env.DSH_TOKEN_URL.trim() !== '') {
    return process.env.DSH_TOKEN_URL.trim()
  }
  const logPath = process.env.DSH_BOOT_LOG || '/tmp/dsh-e2e.log'
  let log
  try {
    log = readFileSync(logPath, 'utf8')
  } catch {
    return undefined
  }
  const match = log.match(/https?:\/\/[^\s]+[?&]token=[A-Za-z0-9_-]+/)
  return match ? match[0] : undefined
}

test.beforeEach(async ({ page }) => {
  const url = tokenUrl()
  if (url !== undefined) {
    await page.goto(url, { waitUntil: 'commit', timeout: 30_000 })
  }
})

async function openSettings(page) {
  for (let attempt = 0; attempt < 5; attempt++) {
    // Dismiss any onboarding overlay by clicking the masked backdrop.
    const modal = page.locator('[role="presentation"]').first()
    if ((await modal.count()) > 0) {
      const mask = modal.locator('[aria-hidden="true"]').first()
      if ((await mask.count()) > 0) {
        await mask.click({ position: { x: 5, y: 5 } }).catch(() => {})
      }
      await page.waitForTimeout(250)
    }

    // Dismiss known first-run prompt buttons.
    for (const name of DISMISS_LABELS) {
      const dismiss = page.getByRole('button', { name, exact: true })
      if ((await dismiss.count()) > 0) {
        await dismiss.click().catch(() => {})
        await expect(dismiss).not.toBeVisible({ timeout: 2000 }).catch(() => {})
      }
    }

    try {
      await page.getByRole('button', { name: '设置', exact: true }).first().click({ timeout: 3000 })
      return true
    } catch {
      // A modal probably mounted just in time; loop and dismiss it again.
    }
  }
  return false
}

test('设置编排 is present near the top of the Settings nav', async ({ page }) => {
  await page.goto('/')
  expect(await openSettings(page), 'settings should open after dismissing first-run dialogs').toBe(true)

  const nav = page.locator('[role="dialog"] nav')
  await expect(nav.getByRole('button', { name: '设置编排' })).toBeVisible()
  // order 1 → second slot, right after 通用设置
  await expect(nav.getByRole('button').nth(1)).toHaveText('设置编排')
})

test('manager panel renders a row per section with a switch, and toggling hides/restores', async ({ page }) => {
  await page.goto('/')
  expect(await openSettings(page), 'settings should open after dismissing first-run dialogs').toBe(true)

  const nav = page.locator('[role="dialog"] nav')
  await nav.getByRole('button', { name: '设置编排' }).click()

  const dialog = page.locator('[role="dialog"]')
  const rows = dialog.locator('li')
  const count = await rows.count()
  // Base DSH profiles render 通用设置/设置编排/模型/插件… — assert a healthy
  // minimum rather than a specific plugin count so the test is profile-agnostic.
  expect(count).toBeGreaterThanOrEqual(4)
  await expect(rows.first().getByRole('switch')).toBeVisible()
  await expect(dialog.locator('.dsm-reset-all')).toBeVisible()

  // Toggle "模型" (id `models`, shown in the meta line) off → it leaves the nav.
  const retryRow = rows.filter({ hasText: 'models' })
  await retryRow.getByRole('switch').click()
  await expect(nav.getByRole('button', { name: '模型', exact: true })).toHaveCount(0)

  // Toggle it back on → returns.
  await retryRow.getByRole('switch').click()
  await expect(nav.getByRole('button', { name: '模型', exact: true })).toBeVisible()
})

test('drag & drop moves a section and clears the drop highlight', async ({ page }) => {
  await page.goto('/')
  expect(await openSettings(page), 'settings should open after dismissing first-run dialogs').toBe(true)

  const nav = page.locator('[role="dialog"] nav')
  await nav.getByRole('button', { name: '设置编排' }).click()
  const dialog = page.locator('[role="dialog"]')
  const rows = dialog.locator('li')

  const orderOf = async (label) => {
    const texts = await nav.getByRole('button').allTextContents()
    return texts.indexOf(label)
  }
  const before = await orderOf('设置编排')

  // Drag "设置编排" (near the top) down onto the LAST row — guaranteed
  // non-adjacent on any profile with ≥3 rows, so either a before/after
  // placement moves it (a drop at the exact middle of an adjacent target
  // computes 'before', a no-op). Index-based targeting keeps the test
  // profile-agnostic.
  const src = rows.filter({ hasText: '设置编排' }).first()
  const dst = rows.nth((await rows.count()) - 1)
  await src.scrollIntoViewIfNeeded()
  await dst.scrollIntoViewIfNeeded()
  const a = await src.boundingBox()
  const b = await dst.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 })

  // Mid-drag: the insertion indicator line is visible.
  await expect(dialog.locator('.dsm-drop-indicator')).toHaveCount(1)

  await page.mouse.up()

  // The row moved (down one slot)…
  await expect.poll(async () => (await orderOf('设置编排')) > before).toBe(true)

  // …and the insertion indicator is gone after the drop.
  await expect(dialog.locator('.dsm-drop-indicator')).toHaveCount(0)

  // Clean up: restore the original order so later runs start from a clean slate.
  await dialog.locator('.dsm-reset-all').click()
  await expect.poll(async () => (await orderOf('设置编排')) === before).toBe(true)
})

test('reset-all restores the original nav order after a reorder', async ({ page }) => {
  await page.goto('/')
  expect(await openSettings(page), 'settings should open after dismissing first-run dialogs').toBe(true)

  const nav = page.locator('[role="dialog"] nav')
  await nav.getByRole('button', { name: '设置编排' }).click()
  const dialog = page.locator('[role="dialog"]')
  const rows = dialog.locator('li')

  const orderOf = async (label) => {
    const texts = await nav.getByRole('button').allTextContents()
    return texts.indexOf(label)
  }
  const modelsBefore = await orderOf('模型')

  // Click ↓ once → 模型 moves down one slot (live). Anchor on the unique id
  // (`models` in the meta line) so it never collides with 模型能力与档位.
  const modelsRow = rows.filter({ hasText: 'models' })
  await modelsRow.locator('.dsm-icon-btn').nth(1).click()
  await expect.poll(async () => (await orderOf('模型')) > modelsBefore).toBe(true)

  // Reset all → original position restored.
  await dialog.locator('.dsm-reset-all').click()
  await expect.poll(async () => (await orderOf('模型')) === modelsBefore).toBe(true)
})

test('rename changes the section name in the nav and persists across reload', async ({ page }) => {
  await page.goto('/')
  expect(await openSettings(page), 'settings should open after dismissing first-run dialogs').toBe(true)

  const nav = page.locator('[role="dialog"] nav')
  await nav.getByRole('button', { name: '设置编排' }).click()
  const dialog = page.locator('[role="dialog"]')
  const rows = dialog.locator('li')

  // Open the rename editor on the "模型" row (id `models`, shown in the meta
  // line) via the pencil icon. The plain hasText filter would also match
  // 模型能力与档位, so anchor on the unique id.
  const modelRow = dialog.locator('li').filter({ hasText: 'models' })
  await modelRow.getByRole('button', { name: '改名' }).click()
  const input = dialog.locator('.dsm-rename-input')
  await expect(input).toBeVisible()

  const renamed = `模型·${Date.now()}`
  await input.fill(renamed)
  await input.press('Enter')

  // The nav now shows the custom name (persisted live).
  await expect(nav.getByRole('button', { name: renamed })).toBeVisible()

  // Reload → still applied (server-side settings persistence).
  await page.reload()
  expect(await openSettings(page), 'settings should re-open after reload').toBe(true)
  await expect(nav.getByRole('button', { name: renamed })).toBeVisible()

  // Restore: reset the row reverts the name.
  await nav.getByRole('button', { name: '设置编排' }).click()
  const renamedRow = dialog.locator('li').filter({ hasText: renamed })
  await renamedRow.getByRole('button', { name: '重置' }).click()
  await expect(nav.getByRole('button', { name: renamed })).toHaveCount(0)
  await expect(nav.getByRole('button', { name: '模型', exact: true })).toBeVisible()
})

