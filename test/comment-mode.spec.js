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
  // Extracts both the rendered pin's position and the anchored sentence's
  // own bounding rect (accounting for scroll), so the test can assert the
  // pin sits where the text actually is, not just that it didn't move. A
  // pin hardcoded to left:0;top:0 would still pass a before/after-reload
  // equality check alone, which is why that assertion isn't sufficient on
  // its own.
  async function pinAndAnchorRects(page) {
    return page.evaluate(() => {
      const host = document.querySelector('[data-comment-mode-host]');
      const pin = host.shadowRoot.querySelector('.cm-pin');
      const stored = JSON.parse(localStorage.getItem('comment-mode:comments:fixture-page'));
      const quote = stored[0].anchor.quote.exact;
      const p = document.getElementById('detail');
      const textNode = p.firstChild;
      const idx = textNode.nodeValue.indexOf(quote);
      const range = document.createRange();
      range.setStart(textNode, idx);
      range.setEnd(textNode, idx + quote.length);
      const rect = range.getBoundingClientRect();
      return {
        pin: pin ? { left: parseFloat(pin.style.left), top: parseFloat(pin.style.top) } : null,
        anchor: { left: rect.left + window.scrollX, top: rect.top + window.scrollY }
      };
    });
  }

  test('a pin placed before reload is back in the same, correct place after reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();
    const box = await page.locator('#detail').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + box.width * 0.2, box.y + box.height / 2);
    await page.locator('textarea').fill('Where did this number come from?');
    await page.getByRole('button', { name: 'Save' }).tap();

    const before = await pinAndAnchorRects(page);
    expect(before.pin).not.toBeNull();
    expect(Math.abs(before.pin.left - before.anchor.left)).toBeLessThanOrEqual(5);
    expect(Math.abs(before.pin.top - before.anchor.top)).toBeLessThanOrEqual(5);

    await page.reload();

    const after = await pinAndAnchorRects(page);
    expect(after.pin).not.toBeNull();
    expect(Math.abs(after.pin.left - after.anchor.left)).toBeLessThanOrEqual(5);
    expect(Math.abs(after.pin.top - after.anchor.top)).toBeLessThanOrEqual(5);

    // Still assert stability across reload too, now that we know the
    // position is meaningful rather than coincidentally identical.
    expect(after.pin).toEqual(before.pin);
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
    expect(hostToggleStyle.backgroundColor).not.toBe('rgb(255, 255, 255)'); // not comment mode's white
    expect(hostToggleStyle.borderRadius).not.toBe('999px'); // not comment mode's pill shape

    const hostQuoteStyle = await page.evaluate(() => {
      const computed = getComputedStyle(document.getElementById('host-quote'));
      return { color: computed.color, fontSize: computed.fontSize };
    });
    expect(hostQuoteStyle.color).toBe('rgb(255, 165, 0)'); // host's own orange
    expect(hostQuoteStyle.color).not.toBe('rgb(68, 68, 68)'); // not comment mode's #444
    expect(hostQuoteStyle.fontSize).toBe('40px'); // host's own size, not comment mode's 0.85rem
    expect(hostQuoteStyle.fontSize).not.toBe('13.6px'); // not comment mode's 0.85rem at a 16px root
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

  test('an explicit pageReference with an empty id throws instead of silently falling back to head meta', async ({ page }) => {
    await page.goto('/test/fixtures/page-invalid-reference.html');
    const errorMessage = await page.evaluate(() => window.commentModeInitError);
    expect(errorMessage).toContain('pageReference');

    const storedUnderHeadMeta = await page.evaluate(() =>
      localStorage.getItem('comment-mode:comments:from-head-meta-invalid-test')
    );
    expect(storedUnderHeadMeta).toBeNull();
  });

  test('comment mode never infers a page reference from location.href', async ({ page }) => {
    await page.goto('/test/fixtures/page-no-reference.html');
    const errorMessage = await page.evaluate(() => window.commentModeInitError);
    expect(errorMessage).toContain('no page reference');
  });
});

test.describe('tap precision', () => {
  // Regression test for the off-by-one in pointIsOnCharacter: a tap on the
  // right half of a glyph can come back from the caret API as the offset of
  // the *next* character, so checking only that next character's rect
  // (with a small tolerance) silently dropped the tap. This fixture has no
  // letter-spacing override (unlike page.html, whose aggressive `* {
  // letter-spacing: 4px !important }` rule is there to test style
  // isolation, not tap geometry), so each glyph's rect is exactly where the
  // browser renders it.
  test('a tap at 75% across every glyph in a heading opens the comment sheet', async ({ page }) => {
    await page.goto('/test/fixtures/page-tap-precision.html');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    const text = await page.locator('#heading').textContent();
    for (let i = 0; i < text.length; i++) {
      if (/\s/.test(text[i])) continue; // whitespace has no meaningful glyph rect to tap
      const rect = await page.evaluate((index) => {
        const heading = document.getElementById('heading');
        const textNode = heading.firstChild;
        const range = document.createRange();
        range.setStart(textNode, index);
        range.setEnd(textNode, index + 1);
        const r = range.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      }, i);
      if (rect.width === 0) continue;

      await page.touchscreen.tap(rect.left + rect.width * 0.75, rect.top + rect.height / 2);
      await expect(page.locator('textarea')).toBeVisible();
      await page.getByRole('button', { name: 'Cancel' }).tap();
      await expect(page.locator('textarea')).toHaveCount(0);
    }
  });
});

test.describe('anchor context', () => {
  // Regression test for buildTextIndex walking into <script>/<style>
  // content: prefix/suffix context is sliced from the whole page's
  // flattened text, so an adjacent inline <script> or <style> element used
  // to end up inside a comment's saved anchor context.
  test('prefix and suffix context skip inline script and style content', async ({ page }) => {
    await page.goto('/test/fixtures/page-script-context.html');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    const box = await page.locator('#target').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);

    await page.locator('textarea').fill('checking anchor context');
    await page.getByRole('button', { name: 'Save' }).tap();

    const stored = await page.evaluate(() =>
      localStorage.getItem('comment-mode:comments:script-context-fixture')
    );
    expect(stored).not.toBeNull();
    const comments = JSON.parse(stored);
    const quote = comments[0].anchor.quote;

    expect(quote.exact).toBe('Target visible sentence for anchor testing.');
    expect(quote.prefix).not.toContain('window.');
    expect(quote.suffix).not.toContain('window.');
    expect(quote.prefix).toContain('before target');
    expect(quote.suffix).toContain('Suffix');
  });
});

test.describe('selection blocking', () => {
  test('double-tapping text while comment mode is active does not select it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    await page.locator('#intro').dblclick();

    const selection = await page.evaluate(() => String(window.getSelection()));
    expect(selection).toBe('');
  });
});

test.describe('init timing', () => {
  // Regression test: calling init() from a <head> inline script used to
  // throw "Cannot read properties of null (reading 'appendChild')" because
  // document.body doesn't exist yet at that point. init() now defers its
  // DOM setup until DOMContentLoaded (or immediately if the document is
  // already past 'loading'), so this must both not throw and still work.
  test('calling init() from a head inline script does not throw and comment mode still works', async ({ page }) => {
    await page.goto('/test/fixtures/page-head-init.html');

    const initError = await page.evaluate(() => window.commentModeInitError);
    expect(initError).toBeNull();

    await expect(page.getByRole('button', { name: 'Comment mode', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    const box = await page.locator('#intro').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + 4, box.y + 4);

    await expect(page.locator('textarea')).toBeVisible();
  });
});

test.describe('malformed stored comments', () => {
  // Regression test: a single malformed stored comment (e.g. missing
  // `anchor`) used to throw uncaught while rendering pins during init(),
  // aborting the whole page's rendering and leaving the toggle half-wired.
  test('a malformed stored comment does not prevent other valid comments from rendering', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'comment-mode:comments:fixture-page',
        JSON.stringify([
          { id: 'bad', text: 'missing anchor entirely' },
          { id: 'also-bad', anchor: {}, text: 'anchor with no quote' },
          {
            id: 'good',
            anchor: {
              quote: {
                exact: 'This is the first sentence of the introduction.',
                prefix: '',
                suffix: ''
              }
            },
            text: 'a valid comment',
            createdAt: new Date().toISOString()
          }
        ])
      );
    });

    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Comment mode', exact: true })).toBeVisible();
    const pinCount = await page.evaluate(() => {
      const host = document.querySelector('[data-comment-mode-host]');
      return host.shadowRoot.querySelectorAll('.cm-pin').length;
    });
    expect(pinCount).toBe(1);
  });
});
