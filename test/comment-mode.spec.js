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

test.describe('scopes', () => {
  // Taps land on the midpoint of a specific word's glyphs, computed from the
  // element's own first text node, so these tests don't depend on the
  // element's overall bounding box (which can span several words).
  async function tapPointOnWord(page, elementId, word) {
    return page.evaluate(
      ({ elementId, word }) => {
        const el = document.getElementById(elementId);
        const textNode = el.firstChild;
        const idx = textNode.nodeValue.indexOf(word);
        const mid = idx + Math.floor(word.length / 2);
        const range = document.createRange();
        range.setStart(textNode, mid);
        range.setEnd(textNode, mid + 1);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      },
      { elementId, word }
    );
  }

  function scopeLabel(page) {
    return page.locator('[data-comment-mode-host]').locator('.cm-scope-label');
  }
  function quoteText(page) {
    return page.locator('[data-comment-mode-host]').locator('.cm-quote');
  }
  function narrowButton(page) {
    return page.locator('[data-comment-mode-host]').getByRole('button', { name: 'Narrow scope' });
  }
  function widenButton(page) {
    return page.locator('[data-comment-mode-host]').getByRole('button', { name: 'Widen scope' });
  }

  test('default scope is sentence for a tap on text, and the −/+ controls step word/sentence/block/section with a live quote preview', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    const point = await tapPointOnWord(page, 'intro', 'second');
    await page.touchscreen.tap(point.x, point.y);

    await expect(scopeLabel(page)).toHaveText('sentence');
    await expect(quoteText(page)).toContainText('second sentence');

    // Widen: sentence -> block. The whole paragraph, all three sentences.
    await widenButton(page).tap();
    await expect(scopeLabel(page)).toHaveText('block');
    await expect(quoteText(page)).toContainText('first sentence');
    await expect(quoteText(page)).toContainText('second sentence');
    await expect(quoteText(page)).toContainText('third one');

    // Widen: block -> section. #intro's page has a single heading, so the
    // section covers the rest of the body too — including content well past
    // the 160-character preview truncation, so assert on the section's
    // start (still visible in the truncated preview) and its overall length
    // rather than text further in.
    const blockQuoteLength = (await quoteText(page).textContent()).length;
    await widenButton(page).tap();
    await expect(scopeLabel(page)).toHaveText('section');
    await expect(quoteText(page)).toContainText('Weekly Digest Email');
    const sectionQuoteLength = (await quoteText(page).textContent()).length;
    expect(sectionQuoteLength).toBeGreaterThan(blockQuoteLength);
    await expect(widenButton(page)).toBeDisabled();

    // Narrow back down: section -> block -> sentence -> word.
    await narrowButton(page).tap();
    await expect(scopeLabel(page)).toHaveText('block');
    await narrowButton(page).tap();
    await expect(scopeLabel(page)).toHaveText('sentence');
    await expect(quoteText(page)).toContainText('second sentence');
    await narrowButton(page).tap();
    await expect(scopeLabel(page)).toHaveText('word');
    await expect(quoteText(page)).toContainText('second');
    await expect(quoteText(page)).not.toContainText('sentence');
    await expect(narrowButton(page)).toBeDisabled();
  });

  test('a tap on text whose block wraps it entirely in an inline element still resolves a block', async ({ page }) => {
    // Regression: isBlockEl's div/main/... branch must not require a block's
    // text to be a *direct* child text node. A <div><span>...</span></div>
    // has all its text nested one level deeper, inside an inline <span>
    // that never itself qualifies as a block; the div must still be found.
    await page.goto('/test/fixtures/page-scopes.html');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    const point = await tapPointOnWord(page, 'span-wrapped-text', 'inside');
    await page.touchscreen.tap(point.x, point.y);

    await expect(scopeLabel(page)).toHaveText('sentence');
    await expect(quoteText(page)).toContainText('All of this text is inside a span.');
  });

  test('a tap on loose text inside a div that also contains a nested block still anchors to that text, not the nested block', async ({ page }) => {
    // Regression for FOR-440 review finding #2: the "leaf" block rule
    // introduced for whitespace-tap resolution used to also apply to real
    // text taps, so a <div> containing both loose text and a nested <p> no
    // longer counted as a block at all (because it "contains" the nested
    // <p>). A tap on the loose text then fell through to the whitespace
    // fallback and mis-anchored to the unrelated nested paragraph.
    await page.goto('/test/fixtures/page-scopes.html');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    // #loose-text-wrapper's first child is the <strong>, not a text node —
    // the loose text " Remember this rule. " is the wrapper's *second* child
    // node, so it can't reuse tapPointOnWord's `el.firstChild` assumption.
    const point = await page.evaluate(() => {
      const el = document.getElementById('loose-text-wrapper');
      const textNode = el.childNodes[1];
      const idx = textNode.nodeValue.indexOf('Remember');
      const mid = idx + 4;
      const range = document.createRange();
      range.setStart(textNode, mid);
      range.setEnd(textNode, mid + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.touchscreen.tap(point.x, point.y);

    await expect(scopeLabel(page)).toHaveText('sentence');
    await expect(quoteText(page)).toContainText('Remember this rule.');
    await expect(quoteText(page)).not.toContainText('Other paragraph');
  });

  test('a hyphenated word stays whole at word scope', async ({ page }) => {
    await page.goto('/test/fixtures/page-scopes.html');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    const point = await tapPointOnWord(page, 'hyphen-para', 'well-known');
    await page.touchscreen.tap(point.x, point.y);
    await narrowButton(page).tap();

    await expect(scopeLabel(page)).toHaveText('word');
    // Exact match, not toContainText: a wrong fallback to the whole sentence
    // ("This is a well-known result worth noting.") would also contain the
    // substring "well-known" and pass a weaker assertion.
    await expect(quoteText(page)).toHaveText('“well-known”');
  });

  test('a tap in a code block resolves word scope to a single token, not the whole block', async ({ page }) => {
    await page.goto('/test/fixtures/page-scopes.html');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    const point = await tapPointOnWord(page, 'code-block', 'y');
    await page.touchscreen.tap(point.x, point.y);
    await narrowButton(page).tap();

    await expect(scopeLabel(page)).toHaveText('word');
    // Exact match: a wrong fallback to the whole block would still contain
    // "y" (e.g. inside "const y = 2;") and pass a substring assertion.
    await expect(quoteText(page)).toHaveText('“y”');
  });

  test('a tap on the right edge of the last character of a block still resolves the tapped word', async ({ page }) => {
    // Regression for FOR-440 review finding #4: getWordAt didn't clamp an
    // off-by-one caret offset (a tap on the right half of the final glyph)
    // the way getSentenceAt already did, so it silently fell back to the
    // whole block instead of the tapped word.
    await page.goto('/test/fixtures/page-scopes.html');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    const point = await page.evaluate(() => {
      const p = document.getElementById('tail-word');
      const textNode = p.firstChild;
      const range = document.createRange();
      range.setStart(textNode, textNode.length - 1);
      range.setEnd(textNode, textNode.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width - 1, y: rect.top + rect.height / 2 };
    });
    await page.touchscreen.tap(point.x, point.y);
    await narrowButton(page).tap();

    await expect(scopeLabel(page)).toHaveText('word');
    await expect(quoteText(page)).toHaveText('“world”');
  });

  test('a tap on an image defaults to block scope, describes the image, and cannot narrow further', async ({ page }) => {
    await page.goto('/test/fixtures/page-scopes.html');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    const box = await page.locator('#fixture-image').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);

    await expect(scopeLabel(page)).toHaveText('block');
    await expect(quoteText(page)).toContainText('digest email');
    await expect(narrowButton(page)).toBeDisabled();

    await widenButton(page).tap();
    await expect(scopeLabel(page)).toHaveText('section');
  });

  test('saving a comment on an image shows a pin, since its description is never literally on the page', async ({ page }) => {
    // Regression: an image anchor's quote ("[image: ...]") can never be
    // found by a text search, so rendering its pin must fall back to the
    // anchor's stored CSS path instead of silently rendering nothing.
    await page.goto('/test/fixtures/page-scopes.html');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    const box = await page.locator('#fixture-image').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('textarea').fill('Nice mockup.');
    await page.getByRole('button', { name: 'Save' }).tap();

    const pinCount = await page.evaluate(() => {
      const host = document.querySelector('[data-comment-mode-host]');
      return host.shadowRoot.querySelectorAll('.cm-pin').length;
    });
    expect(pinCount).toBe(1);
  });

  test('a tap in whitespace resolves to the nearest block at block scope, flagged near', async ({ page }) => {
    await page.goto('/test/fixtures/page-scopes.html');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    await page.locator('#whitespace-gap').scrollIntoViewIfNeeded();
    const box = await page.locator('#whitespace-gap').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + 5);

    await expect(scopeLabel(page)).toHaveText('block');
    await expect(quoteText(page)).toContainText('(near)');

    await page.locator('textarea').fill('Nearest block, not exact.');
    await page.getByRole('button', { name: 'Save' }).tap();

    const stored = await page.evaluate(() =>
      localStorage.getItem('comment-mode:comments:scopes-fixture')
    );
    const comments = JSON.parse(stored);
    expect(comments[0].anchor.near).toBe(true);
    expect(comments[0].anchor.scope).toBe('block');
    expect(comments[0].anchor.quote.exact).toBe('Text before a big gap.');
  });

  test('table cells and list items keep their boundaries at section scope, instead of running together', async ({ page }) => {
    await page.goto('/test/fixtures/page-scopes.html');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    const point = await tapPointOnWord(page, 'cell-a', 'Alpha');
    await page.touchscreen.tap(point.x, point.y);
    // sentence -> block -> section
    await widenButton(page).tap();
    await widenButton(page).tap();

    await expect(scopeLabel(page)).toHaveText('section');
    const text = await quoteText(page).textContent();
    expect(text).toMatch(/Alpha\s+Beta/);
    expect(text).not.toContain('AlphaBeta');
    expect(text).toMatch(/First item\s+Second item/);
    expect(text).not.toContain('itemSecond');
    // The next section's heading and content must not have leaked in.
    expect(text).not.toContain('Visuals');
  });

  test('block scope on a table cell resolves to just that cell, not the whole row or table', async ({ page }) => {
    await page.goto('/test/fixtures/page-scopes.html');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    const point = await tapPointOnWord(page, 'cell-a', 'Alpha');
    await page.touchscreen.tap(point.x, point.y);
    await widenButton(page).tap(); // sentence -> block

    await expect(scopeLabel(page)).toHaveText('block');
    await expect(quoteText(page)).toHaveText('“Alpha”');
  });

  test('default scope is sentence, and sentence/word scope both resolve correctly, for a tap inside a list item', async ({ page }) => {
    await page.goto('/test/fixtures/page-scopes.html');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    const point = await tapPointOnWord(page, 'item-a', 'First');
    await page.touchscreen.tap(point.x, point.y);

    await expect(scopeLabel(page)).toHaveText('sentence');
    await expect(quoteText(page)).toHaveText('“First item”');

    await narrowButton(page).tap();
    await expect(scopeLabel(page)).toHaveText('word');
    await expect(quoteText(page)).toHaveText('“First”');
  });

  test('default scope is sentence, and sentence/word scope both resolve correctly, for a tap inside a table cell', async ({ page }) => {
    await page.goto('/test/fixtures/page-scopes.html');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    const point = await tapPointOnWord(page, 'cell-a', 'Alpha');
    await page.touchscreen.tap(point.x, point.y);

    await expect(scopeLabel(page)).toHaveText('sentence');
    await expect(quoteText(page)).toHaveText('“Alpha”');

    await narrowButton(page).tap();
    await expect(scopeLabel(page)).toHaveText('word');
    await expect(quoteText(page)).toHaveText('“Alpha”');
  });

  test('a whitespace ("near") pin is positioned over its resolved block, not just present, after reload', async ({ page }) => {
    await page.goto('/test/fixtures/page-scopes.html');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    await page.locator('#whitespace-gap').scrollIntoViewIfNeeded();
    const gapBox = await page.locator('#whitespace-gap').boundingBox();
    if (!gapBox) throw new Error('missing bounding box');
    await page.touchscreen.tap(gapBox.x + gapBox.width / 2, gapBox.y + 5);
    await page.locator('textarea').fill('Nearest block, not exact.');
    await page.getByRole('button', { name: 'Save' }).tap();

    async function pinOverTarget() {
      return page.evaluate(() => {
        const host = document.querySelector('[data-comment-mode-host]');
        const pin = host.shadowRoot.querySelector('.cm-pin');
        const target = document.getElementById('before-gap');
        const targetRect = target.getBoundingClientRect();
        return {
          pin: pin ? { left: parseFloat(pin.style.left), top: parseFloat(pin.style.top) } : null,
          target: { left: targetRect.left + window.scrollX, top: targetRect.top + window.scrollY }
        };
      });
    }

    const before = await pinOverTarget();
    expect(before.pin).not.toBeNull();
    expect(Math.abs(before.pin.left - before.target.left)).toBeLessThanOrEqual(5);
    expect(Math.abs(before.pin.top - before.target.top)).toBeLessThanOrEqual(5);

    await page.reload();

    const after = await pinOverTarget();
    expect(after.pin).not.toBeNull();
    expect(Math.abs(after.pin.left - after.target.left)).toBeLessThanOrEqual(5);
    expect(Math.abs(after.pin.top - after.target.top)).toBeLessThanOrEqual(5);
  });

  test('an image pin is positioned over its image, not just present, after reload', async ({ page }) => {
    await page.goto('/test/fixtures/page-scopes.html');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    const box = await page.locator('#fixture-image').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('textarea').fill('Nice mockup.');
    await page.getByRole('button', { name: 'Save' }).tap();

    async function pinOverImage() {
      return page.evaluate(() => {
        const host = document.querySelector('[data-comment-mode-host]');
        const pin = host.shadowRoot.querySelector('.cm-pin');
        const img = document.getElementById('fixture-image');
        const imgRect = img.getBoundingClientRect();
        return {
          pin: pin ? { left: parseFloat(pin.style.left), top: parseFloat(pin.style.top) } : null,
          image: { left: imgRect.left + window.scrollX, top: imgRect.top + window.scrollY }
        };
      });
    }

    const before = await pinOverImage();
    expect(before.pin).not.toBeNull();
    expect(Math.abs(before.pin.left - before.image.left)).toBeLessThanOrEqual(5);
    expect(Math.abs(before.pin.top - before.image.top)).toBeLessThanOrEqual(5);

    await page.reload();

    const after = await pinOverImage();
    expect(after.pin).not.toBeNull();
    expect(Math.abs(after.pin.left - after.image.left)).toBeLessThanOrEqual(5);
    expect(Math.abs(after.pin.top - after.image.top)).toBeLessThanOrEqual(5);
  });

  test('an image anchor resolves back to the correct image after reload, not a structurally similar one', async ({ page }) => {
    // Regression for FOR-440 review finding #3: an image's stored CSS path
    // is resolved with document.body.querySelector(path), which matches the
    // path anywhere in the document rather than scoping it to the direct-
    // child chain from body it was built from. #decoy-img's own local
    // <div> > <img> pair satisfies the same relative nth-of-type pattern as
    // #colliding-img's stored (body-relative) path and comes first in
    // document order, so an unscoped resolution mis-locates the pin there.
    await page.goto('/test/fixtures/page-scopes.html');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();

    await page.locator('#colliding-img').scrollIntoViewIfNeeded();
    const box = await page.locator('#colliding-img').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('textarea').fill('This one, not the decoy.');
    await page.getByRole('button', { name: 'Save' }).tap();

    await page.reload();

    const rects = await page.evaluate(() => {
      const host = document.querySelector('[data-comment-mode-host]');
      const pin = host.shadowRoot.querySelector('.cm-pin');
      const target = document.getElementById('colliding-img').getBoundingClientRect();
      const decoy = document.getElementById('decoy-img').getBoundingClientRect();
      return {
        pin: pin ? { left: parseFloat(pin.style.left), top: parseFloat(pin.style.top) } : null,
        target: { left: target.left + window.scrollX, top: target.top + window.scrollY },
        decoy: { left: decoy.left + window.scrollX, top: decoy.top + window.scrollY }
      };
    });

    expect(rects.pin).not.toBeNull();
    expect(Math.abs(rects.pin.left - rects.target.left)).toBeLessThanOrEqual(5);
    expect(Math.abs(rects.pin.top - rects.target.top)).toBeLessThanOrEqual(5);
    // Guard against a coincidental pass: the decoy must actually be
    // elsewhere on the page, not overlapping the target.
    expect(Math.abs(rects.target.top - rects.decoy.top)).toBeGreaterThan(10);
  });
});

test.describe('sentiment', () => {
  test('a comment saved without picking a sentiment defaults to neutral', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();
    const box = await page.locator('#intro').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + 4, box.y + 4);

    await page.locator('textarea').fill('Defaults to neutral.');
    await page.getByRole('button', { name: 'Save' }).tap();

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('comment-mode:comments:fixture-page'))
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].sentiment).toBe('neutral');
  });

  test('picking a sentiment saves it on the comment', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();
    const box = await page.locator('#intro').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + 4, box.y + 4);

    await page.getByRole('button', { name: 'Negative', exact: true }).tap();
    await page.locator('textarea').fill('This part is wrong.');
    await page.getByRole('button', { name: 'Save' }).tap();

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('comment-mode:comments:fixture-page'))
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].sentiment).toBe('negative');
  });
});

test.describe('author and metadata', () => {
  test('author and meta configured at init are stamped on a new comment', async ({ page }) => {
    await page.goto('/test/fixtures/page-author-meta.html');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();
    const box = await page.locator('#intro').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + 4, box.y + 4);

    await page.locator('textarea').fill('Needs another pass.');
    await page.getByRole('button', { name: 'Save' }).tap();

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('comment-mode:comments:author-meta-fixture'))
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].author).toEqual({ name: 'Ada Lovelace', id: 'user-42' });
    expect(stored[0].meta).toEqual({ team: 'design', ticket: 'FOR-441' });
  });

  test('a comment created with no author or meta configured stores neither field', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();
    const box = await page.locator('#intro').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + 4, box.y + 4);

    await page.locator('textarea').fill('No author configured on this page.');
    await page.getByRole('button', { name: 'Save' }).tap();

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('comment-mode:comments:fixture-page'))
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].author).toBeUndefined();
    expect(stored[0].meta).toBeUndefined();
  });

  test('a comment keeps the author/meta snapshot from its own creation, even after the host mutates its config object', async ({ page }) => {
    await page.goto('/test/fixtures/page-author-meta.html');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();
    let box = await page.locator('#intro').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + 4, box.y + 4);
    await page.locator('textarea').fill('First comment.');
    await page.getByRole('button', { name: 'Save' }).tap();

    // The host mutates the very config object it passed to init(), in
    // place, the way a real host's own state might change after init.
    await page.evaluate(() => {
      window.cmConfig.author.name = 'Ada';
      window.cmConfig.meta.ticket = 'FOR-999';
    });

    box = await page.locator('#secondary').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + 4, box.y + 4);
    await page.locator('textarea').fill('Second comment.');
    await page.getByRole('button', { name: 'Save' }).tap();

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('comment-mode:comments:author-meta-fixture'))
    );
    expect(stored).toHaveLength(2);
    // Comment one keeps the snapshot taken when it was created, unaffected
    // by the host's later mutation of its own config object.
    expect(stored[0].author).toEqual({ name: 'Ada Lovelace', id: 'user-42' });
    expect(stored[0].meta).toEqual({ team: 'design', ticket: 'FOR-441' });
    // Comment two, created after the mutation, picks up the new values.
    expect(stored[1].author).toEqual({ name: 'Ada', id: 'user-42' });
    expect(stored[1].meta).toEqual({ team: 'design', ticket: 'FOR-999' });
  });
});

test.describe('editing a comment', () => {
  test('reopening a pin lets the text and sentiment change, updating updatedAt', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();
    const box = await page.locator('#intro').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + 4, box.y + 4);

    await page.locator('textarea').fill('Original text.');
    await page.getByRole('button', { name: 'Save' }).tap();

    // Exit comment mode first: reopening an existing comment to edit it must
    // not require placement mode to still be active.
    await page.getByRole('button', { name: 'Exit comment mode', exact: true }).tap();

    await page.locator('[data-comment-mode-host]').locator('.cm-pin').tap();
    await expect(page.locator('textarea')).toHaveValue('Original text.');

    await page.locator('textarea').fill('Revised text.');
    await page.getByRole('button', { name: 'Positive', exact: true }).tap();
    await page.getByRole('button', { name: 'Save' }).tap();

    await expect(page.locator('textarea')).toHaveCount(0);

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('comment-mode:comments:fixture-page'))
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].text).toBe('Revised text.');
    expect(stored[0].sentiment).toBe('positive');
    expect(stored[0].updatedAt).toBeTruthy();
    expect(new Date(stored[0].updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(stored[0].createdAt).getTime()
    );
  });

  test('an edited comment is still there, with its edits, after a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();
    const box = await page.locator('#intro').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + 4, box.y + 4);
    await page.locator('textarea').fill('Before edit.');
    await page.getByRole('button', { name: 'Save' }).tap();

    await page.locator('[data-comment-mode-host]').locator('.cm-pin').tap();
    await page.locator('textarea').fill('After edit.');
    await page.getByRole('button', { name: 'Save' }).tap();

    await page.reload();

    await expect(page.locator('[data-comment-mode-host]').locator('.cm-pin')).toHaveCount(1);
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('comment-mode:comments:fixture-page'))
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].text).toBe('After edit.');
  });

  test('saving without changing text or sentiment does not bump updatedAt', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();
    const box = await page.locator('#intro').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + 4, box.y + 4);
    await page.locator('textarea').fill('Unchanged text.');
    await page.getByRole('button', { name: 'Save' }).tap();

    let stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('comment-mode:comments:fixture-page'))
    );
    expect(stored[0].updatedAt).toBeUndefined();

    // Reopen and save again without touching text or sentiment.
    await page.locator('[data-comment-mode-host]').locator('.cm-pin').tap();
    await expect(page.locator('textarea')).toHaveValue('Unchanged text.');
    await page.getByRole('button', { name: 'Save' }).tap();
    await expect(page.locator('textarea')).toHaveCount(0);

    stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('comment-mode:comments:fixture-page'))
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].text).toBe('Unchanged text.');
    expect(stored[0].updatedAt).toBeUndefined();
  });
});

test.describe('deleting a comment', () => {
  test('deleting a comment hides its pin immediately and keeps the record after reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).tap();
    const box = await page.locator('#intro').boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.touchscreen.tap(box.x + 4, box.y + 4);
    await page.locator('textarea').fill('Delete me.');
    await page.getByRole('button', { name: 'Save' }).tap();

    await expect(page.locator('[data-comment-mode-host]').locator('.cm-pin')).toHaveCount(1);

    await page.locator('[data-comment-mode-host]').locator('.cm-pin').tap();
    await page.getByRole('button', { name: 'Delete' }).tap();

    await expect(page.locator('[data-comment-mode-host]').locator('.cm-pin')).toHaveCount(0);

    let stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('comment-mode:comments:fixture-page'))
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].deleted).toBe(true);
    expect(stored[0].updatedAt).toBeTruthy();

    await page.reload();

    await expect(page.locator('[data-comment-mode-host]').locator('.cm-pin')).toHaveCount(0);
    stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('comment-mode:comments:fixture-page'))
    );
    // The delete is a marker on the kept record, never a removal from
    // storage, so the array still has exactly this one (now-deleted) entry.
    expect(stored).toHaveLength(1);
    expect(stored[0].deleted).toBe(true);
    expect(stored[0].text).toBe('Delete me.');
  });
});
