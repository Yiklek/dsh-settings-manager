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

// First-run / onboarding dialogs can appear in a fresh context. Dismiss them
// the same way the dsh-web-profile CI smoke does: repeatedly dismiss whatever
// modal is present (click the [aria-hidden] mask, tap known dismiss buttons),
// then retry opening Settings until it succeeds.
const DISMISS_LABELS = ['继续', '稍后配置', '知道了', '关闭此提示']

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
  expect(count).toBeGreaterThan(5)
  await expect(rows.first().getByRole('switch')).toBeVisible()
  await expect(dialog.locator('.dsm-reset-all')).toBeVisible()

  // Toggle "API 重试" off → it leaves the nav.
  const retryRow = rows.filter({ hasText: 'API 重试' })
  await retryRow.getByRole('switch').click()
  await expect(nav.getByRole('button', { name: 'API 重试', exact: true })).toHaveCount(0)

  // Toggle it back on → returns.
  await retryRow.getByRole('switch').click()
  await expect(nav.getByRole('button', { name: 'API 重试', exact: true })).toBeVisible()
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

  // Click ↓ once → 模型 moves down one slot (live).
  const modelsRow = rows.filter({ hasText: '模型' })
  await modelsRow.locator('.dsm-icon-btn').nth(1).click()
  await expect.poll(async () => (await orderOf('模型')) > modelsBefore).toBe(true)

  // Reset all → original position restored.
  await dialog.locator('.dsm-reset-all').click()
  await expect.poll(async () => (await orderOf('模型')) === modelsBefore).toBe(true)
})
