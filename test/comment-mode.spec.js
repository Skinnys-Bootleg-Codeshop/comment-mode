// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('comment mode toggle', () => {
  test('outside comment mode, a tap follows a link as normal', async ({ page }) => {
    await page.goto('/');
    await page.locator('#a-link').tap();
    await expect(page).toHaveURL(/link-target\.html$/);
  });

  test('in comment mode, a tap does not follow a link', async ({ page }) => {
    await page.goto('/');
    let linkRequested = false;
    await page.route('**/link-target.html', (route) => {
      linkRequested = true;
      route.continue();
    });

    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();
    await page.locator('#a-link').tap();

    // Give a real navigation a chance to have started before asserting it
    // didn't: waiting on the URL alone would pass trivially before any
    // navigation could occur.
    await page.waitForTimeout(300);

    expect(linkRequested).toBe(false);
    await expect(page).toHaveURL(/page\.html$|\/$/);
  });

  test('toggle label reflects the current state', async ({ page }) => {
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Comment mode', exact: true });
    await toggle.tap();
    await expect(page.getByRole('button', { name: 'Exit comment mode', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Exit comment mode', exact: true }).tap();
    await expect(page.getByRole('button', { name: 'Comment mode', exact: true })).toBeVisible();
  });
});

test.describe('placing a comment', () => {
  test('a tap on a sentence anchors the comment to that sentence, not the whole paragraph', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    // Tap inside the second sentence of #intro.
    const box = await page.locator('#intro').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + box.width * 0.55, box.y + box.height / 2);

    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();
    const quoteText = await page.locator('[data-comment-mode-host]').locator('.cm-quote').textContent();
    expect(quoteText).toContain('second sentence');
    expect(quoteText).not.toContain('first sentence');
    expect(quoteText).not.toContain('third one');
  });

  test('saving a comment stores it under the page reference and shows a pin', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();
    const box = await page.locator('#intro').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + 4, box.y + 4);

    await page.locator('textarea').fill('This sentence needs a source.');
    await page.getByRole('button', { name: 'Save' }).tap();

    await expect(page.locator('textarea')).toHaveCount(0);

    const stored = await page.evaluate(() => localStorage.getItem('comment-mode:comments:fixture-page'));
    expect(stored).not.toBeNull();
    const comments = JSON.parse(stored);
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe('This sentence needs a source.');
    expect(comments[0].anchor.quote.exact).toContain('first sentence');
  });

  test('a tap on the very last character of a block still anchors to a sentence', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    // #tail has no trailing whitespace before </p>; tapping its last character
    // is the off-by-one case where the caret API reports an offset equal to
    // the text node's length. Compute the exact rect of that last character
    // (rather than relying on the paragraph's bounding box) since the
    // fixture's own aggressive letter-spacing/text-transform rules shift
    // where the last glyph actually renders.
    const point = await page.evaluate(() => {
      const p = document.getElementById('tail');
      const textNode = p.firstChild;
      const range = document.createRange();
      range.setStart(textNode, textNode.length - 1);
      range.setEnd(textNode, textNode.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.touchscreen.tap(point.x, point.y);

    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();
    const quoteText = await page.locator('[data-comment-mode-host]').locator('.cm-quote').textContent();
    expect(quoteText).toContain('Last one ends right at the boundary');
    // Without the off-by-one fix, resolution falls back to the whole block,
    // which would incorrectly include the first sentence too.
    expect(quoteText).not.toContain('First sentence here');
  });

  test('outside comment mode, a tap does nothing', async ({ page }) => {
    await page.goto('/');
    const box = await page.locator('#intro').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + box.width * 0.2, box.y + box.height / 2);
    await expect(page.locator('textarea')).toHaveCount(0);
  });
});

test.describe('persistence across reload', () => {
  test('a pin placed before reload is back in the same place after reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();
    const box = await page.locator('#detail').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + box.width * 0.2, box.y + box.height / 2);
    await page.locator('textarea').fill('Where did this number come from?');
    await page.getByRole('button', { name: 'Save' }).tap();

    const pinBefore = await page.evaluate(() => {
      const host = document.querySelector('[data-comment-mode-host]');
      const pin = host.shadowRoot.querySelector('.cm-pin');
      return pin ? { left: pin.style.left, top: pin.style.top } : null;
    });
    expect(pinBefore).not.toBeNull();

    await page.reload();

    const pinAfter = await page.evaluate(() => {
      const host = document.querySelector('[data-comment-mode-host]');
      const pin = host.shadowRoot.querySelector('.cm-pin');
      return pin ? { left: pin.style.left, top: pin.style.top } : null;
    });
    expect(pinAfter).toEqual(pinBefore);
  });
});

test.describe('style isolation', () => {
  // The fixture's `* { letter-spacing: 4px !important; text-transform: uppercase !important }`
  // and `div { position: absolute !important; display: block !important }` rules are chosen
  // specifically to collide with comment mode's own rules and to target the shadow host element
  // itself (a <div>), which is the case that a plain `:host { all: initial }` (without
  // `!important`) fails to guard against.
  test('the host page\'s aggressive rules do not reach comment mode\'s shadow-rendered elements', async ({ page }) => {
    await page.goto('/');
    const toggleStyle = await page.evaluate(() => {
      const host = document.querySelector('[data-comment-mode-host]');
      const toggle = host.shadowRoot.querySelector('.cm-toggle');
      const computed = getComputedStyle(toggle);
      return {
        letterSpacing: computed.letterSpacing,
        textTransform: computed.textTransform,
        fontFamily: computed.fontFamily,
        borderStyle: computed.borderStyle,
        backgroundColor: computed.backgroundColor,
        borderRadius: computed.borderRadius,
      };
    });

    expect(toggleStyle.letterSpacing).not.toBe('4px');
    expect(toggleStyle.textTransform).not.toBe('uppercase');
    expect(toggleStyle.fontFamily).not.toContain('Comic Sans MS');
    expect(toggleStyle.borderStyle).not.toBe('dashed');
    // Comment mode's own inactive-toggle background (#fff), not the host's purple.
    expect(toggleStyle.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(toggleStyle.borderRadius).not.toBe('0px');

    const hostDivStyle = await page.evaluate(() => {
      const host = document.querySelector('[data-comment-mode-host]');
      const computed = getComputedStyle(host);
      return { position: computed.position, display: computed.display };
    });
    // The host page's `div { position: absolute !important; display: block !important }`
    // must not win against `:host { all: initial !important }` on the shadow host div itself.
    expect(hostDivStyle.position).not.toBe('absolute');
  });

  test('comment mode\'s styles do not leak onto host elements with colliding class names', async ({ page }) => {
    await page.goto('/');
    // The fixture defines its own `.cm-toggle` button and `.cm-quote` paragraph in the light
    // DOM. Comment mode's shadow-scoped rules for those class names must not apply to them.
    const hostToggleStyle = await page.evaluate(() => {
      const computed = getComputedStyle(document.getElementById('host-toggle'));
      return { backgroundColor: computed.backgroundColor, borderRadius: computed.borderRadius };
    });
    expect(hostToggleStyle.backgroundColor).toBe('rgb(128, 0, 128)'); // host's own purple
    expect(hostToggleStyle.borderRadius).not.toBe('999px'); // not comment mode's pill shape

    const hostQuoteStyle = await page.evaluate(() => {
      const computed = getComputedStyle(document.getElementById('host-quote'));
      return { color: computed.color, fontSize: computed.fontSize };
    });
    expect(hostQuoteStyle.color).toBe('rgb(255, 165, 0)'); // host's own orange
    expect(hostQuoteStyle.fontSize).toBe('40px'); // host's own size, not comment mode's 0.85rem
  });
});

test.describe('page reference', () => {
  test('setup code wins over a head meta tag when both are present', async ({ page }) => {
    await page.goto('/test/fixtures/page-setup-override.html');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();
    const box = await page.locator('#intro').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + 4, box.y + 4);
    await page.locator('textarea').fill('Anchored under the setup key.');
    await page.getByRole('button', { name: 'Save' }).tap();

    const underSetupKey = await page.evaluate(() =>
      localStorage.getItem('comment-mode:comments:from-setup-code')
    );
    const underMetaKey = await page.evaluate(() =>
      localStorage.getItem('comment-mode:comments:from-head-meta')
    );
    expect(underSetupKey).not.toBeNull();
    expect(underMetaKey).toBeNull();
  });

  test('comment mode never infers a page reference from location.href', async ({ page }) => {
    await page.goto('/test/fixtures/page-no-reference.html');
    const errorMessage = await page.evaluate(() => window.commentModeInitError);
    expect(errorMessage).toContain('no page reference');
  });
});
