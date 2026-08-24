/**
 * Playwright config — runs against a live DSH web instance using the locally
 * installed Microsoft Edge (no Playwright-bundled browser needed).
 *
 *   DSH_WEB_URL=http://127.0.0.1:3080 npx playwright test --config tests/playwright/playwright.config.mjs
 *
 * Each test gets a fresh browser context, so any policy/localStorage changes
 * the test makes are isolated and never touch the user's real profile.
 *
 * Locale is pinned to zh-CN so the first-run dismiss labels match the
 * dsh-web-profile CI's smoke spec ("继续 / 稍后配置 / 知道了 / 关闭此提示").
 */
export default {
  testDir: '.',
  testMatch: '**/*.spec.mjs',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.DSH_WEB_URL || `http://127.0.0.1:${process.env.DSH_PORT || '3080'}`,
    // Local dev uses branded Microsoft Edge; CI (Linux) has no Edge, so it falls
    // back to Playwright's bundled Chromium.
    channel: process.env.CI ? undefined : 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    // Playwright launches the system Edge by default with channel:'msedge';
    // allow overriding the executable via EDGE_PATH if needed.
    ...(process.env.EDGE_PATH ? { executablePath: process.env.EDGE_PATH } : {}),
  },
}
