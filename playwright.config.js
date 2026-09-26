// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// Real browser only, at a phone-sized viewport with touch input: caret/anchor
// resolution and tap-vs-selection behaviour cannot be faithfully tested with
// a DOM emulator (see FOR-439).
module.exports = defineConfig({
  testDir: './test',
  // The Node-based storage contract and sync-engine tests (FOR-444) live
  // under test/storage and test/fakes; they use node:test, not
  // @playwright/test, and must never be collected here (npm run test:node
  // runs them instead). Playwright's default testMatch would otherwise
  // require these *.spec.js files during collection, which eagerly runs
  // their node:test suites as an unwanted side effect.
  testIgnore: ['**/storage/**', '**/fakes/**', '**/contract-suite.js'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node test/serve.js',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI
  },
  projects: [
    {
      name: 'mobile-chrome',
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        // iPhone 13's default device profile targets WebKit; keep its
        // viewport, touch and mobile settings but run on Chromium, the only
        // browser this repo installs (see .github/workflows/ci.yml).
        defaultBrowserType: 'chromium'
      }
    }
  ]
});
