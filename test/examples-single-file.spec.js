// @ts-check
const path = require('path');
const { test, expect } = require('@playwright/test');

// A smoke test for examples/single-file/index.html: proves the worked
// example actually works, not just that it parses. Reuses this suite's
// existing infra (test/serve.js already serves the whole repository, so the
// example's own path just works) and the same toggle/tap/save/reload
// pattern as test/comment-mode.spec.js's "persistence across reload" tests,
// against the example page instead of the fixture.
test.describe('single-file example', () => {
  test('turning on comment mode, placing a comment and reloading keeps it', async ({ page }) => {
    await page.goto('/examples/single-file/index.html');

    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    const box = await page.locator('#how-it-works').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + 4, box.y + 4);

    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();
    await textarea.fill('This example worked for me.');
    await page.getByRole('button', { name: 'Save' }).tap();
    await expect(page.locator('textarea')).toHaveCount(0);

    const host = page.locator('[data-comment-mode-host]');
    await expect(host.locator('.cm-pin')).toHaveCount(1);

    const stored = await page.evaluate(() =>
      localStorage.getItem('comment-mode:comments:single-file-example')
    );
    expect(stored).not.toBeNull();
    const comments = JSON.parse(stored);
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe('This example worked for me.');

    await page.reload();

    await expect(page.locator('[data-comment-mode-host]').locator('.cm-pin')).toHaveCount(1);
    const storedAfterReload = await page.evaluate(() =>
      localStorage.getItem('comment-mode:comments:single-file-example')
    );
    const commentsAfterReload = JSON.parse(storedAfterReload);
    expect(commentsAfterReload).toHaveLength(1);
    expect(commentsAfterReload[0].text).toBe('This example worked for me.');
  });

  // The whole point of this example is that it needs no server at all (its
  // own README/page text says "open it directly from disk"); the test
  // above only proves it works over http://, which test/serve.js provides
  // for every other fixture in this suite. This one instead opens the file
  // via a real file:// URL, with no server involved, so a regression that
  // only works when something happens to be serving the directory (e.g. a
  // path that silently depended on an absolute http(s) origin) would still
  // be caught.
  test('placing a comment and reloading keeps it when opened via a real file:// URL', async ({ page }) => {
    const fileUrl = 'file://' + path.join(__dirname, '..', 'examples', 'single-file', 'index.html');
    await page.goto(fileUrl);

    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    const box = await page.locator('#how-it-works').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + 4, box.y + 4);

    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();
    await textarea.fill('This worked straight from disk.');
    await page.getByRole('button', { name: 'Save' }).tap();
    await expect(page.locator('textarea')).toHaveCount(0);

    const host = page.locator('[data-comment-mode-host]');
    await expect(host.locator('.cm-pin')).toHaveCount(1);

    await page.reload();

    await expect(page.locator('[data-comment-mode-host]').locator('.cm-pin')).toHaveCount(1);
    const storedAfterReload = await page.evaluate(() =>
      localStorage.getItem('comment-mode:comments:single-file-example')
    );
    const commentsAfterReload = JSON.parse(storedAfterReload);
    expect(commentsAfterReload).toHaveLength(1);
    expect(commentsAfterReload[0].text).toBe('This worked straight from disk.');
  });
});
