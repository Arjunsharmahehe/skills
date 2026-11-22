// human driver primitives — eased scroll, bezier mouse, variable typing.
// Ported from the validated demo driver. Do not call Playwright's
// mouse.move / scrollIntoView / fill directly in flows — always use these.

export async function smoothScrollTo(page, targetY, opts = {}) {
  const duration = opts.duration ?? 900;
  await page.evaluate(({ targetY, duration }) => {
    return new Promise((resolve) => {
      const startY = window.scrollY;
      const dist = targetY - startY;
      const t0 = performance.now();
      const easeInOutCubic = (t) =>
        t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      function frame(now) {
        const t = Math.min(1, (now - t0) / duration);
        window.scrollTo(0, startY + dist * easeInOutCubic(t));
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
  }, { targetY, duration });
}

// Scroll element to ~40% viewport height (middle-third framing).
export async function scrollToElement(page, selector, timeoutMs = 3000) {
  // Polls briefly: async re-renders often replace the DOM between
  // navigation settling and this call — a render race, not a broken
  // selector. Still throws if it never appears.
  const deadline = Date.now() + timeoutMs;
  let box = null;
  while (!box) {
    box = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top + window.scrollY, height: r.height };
    }, selector);
    if (box) break;
    if (Date.now() > deadline) throw new Error(`scrollToElement: no match ${selector}`);
    await page.waitForTimeout(250);
  }
  const viewportH = page.viewportSize()?.height ?? 720;
  const targetY = Math.max(0, box.top - viewportH * 0.4 + box.height / 2);
  const dist = Math.abs(targetY - (await page.evaluate(() => window.scrollY)));
  const duration = 700 + Math.min(600, dist * 0.4);
  await smoothScrollTo(page, targetY, { duration });
  await page.waitForTimeout(350); // mandatory settle
}

// Scroll to an absolute Y, "top", or "NN%" of document height.
export async function scrollTo(page, to) {
  let y = 0;
  if (to === 'top') y = 0;
  else if (typeof to === 'string' && to.endsWith('%')) {
    const frac = Math.min(1, Math.max(0, parseFloat(to) / 100));
    const h = await page.evaluate(() => document.body.scrollHeight);
    y = Math.round(h * frac);
  } else y = Number(to) || 0;
  const dist = Math.abs(y - (await page.evaluate(() => window.scrollY)));
  await smoothScrollTo(page, y, { duration: 700 + Math.min(600, dist * 0.4) });
  await page.waitForTimeout(350);
}

// Bezier mouse move: 25-40 steps, easeOutCubic, ±60px control offset.
export async function humanMove(page, x, y) {
  const { mx, my } = await page.evaluate(() => ({
    mx: window.__mx ?? 640,
    my: window.__my ?? 100,
  }));
  const steps = 25 + Math.floor(Math.random() * 15);
  const cx = (mx + x) / 2 + (Math.random() * 120 - 60);
  const cy = (my + y) / 2 + (Math.random() * 120 - 60);
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  for (let i = 1; i <= steps; i++) {
    const t = easeOutCubic(i / steps);
    const ix = (1 - t) * (1 - t) * mx + 2 * (1 - t) * t * cx + t * t * x;
    const iy = (1 - t) * (1 - t) * my + 2 * (1 - t) * t * cy + t * t * y;
    await page.mouse.move(ix, iy);
    await page.waitForTimeout(8 + Math.random() * 10); // 8-18ms per step
    await page.evaluate(({ ix, iy }) => {
      window.__mx = ix; window.__my = iy;
      const c = document.getElementById('__reel_cursor');
      if (c) c.style.transform = `translate(${ix}px, ${iy}px)`;
    }, { ix, iy });
  }
  await page.evaluate(({ x, y }) => { window.__mx = x; window.__my = y; }, { x, y });
}

async function domSnapshot(page) {
  return await page.evaluate(() => ({
    url: location.href,
    layers: document.querySelectorAll('[role="listbox"],[role="menu"],[role="dialog"],[data-floating]').length,
    bodyLen: document.body.innerHTML.length,
  }));
}
function domChanged(a, b) {
  return a.url !== b.url || a.layers !== b.layers || Math.abs(a.bodyLen - b.bodyLen) > 300;
}

export async function humanClick(page, selector) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  if (!box) throw new Error(`humanClick: no match ${selector}`);
  const before = await domSnapshot(page);
  await humanMove(page, box.x, box.y);
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.waitForTimeout(60); // ripple sync window
  await page.mouse.up();
  await page.waitForTimeout(250);
  // A destroyed context here means the click navigated — that IS the
  // effect we wanted, so the fallback is skipped in that case.
  let after = null;
  try { after = await domSnapshot(page); } catch { after = null; }
  // fallback only if the real click had no visible effect (keeps
  // toggle controls like dropdowns from opening then instantly closing)
  if (!after || !domChanged(before, after)) {
    try {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        if (at && (el === at || el.contains(at))) el.click();
      }, selector).catch(() => {});
    } catch {}
  }
}

// Variable-delay typing. Never fill() for demo.
export async function humanType(page, selector, text) {
  await humanClick(page, selector);
  await typeText(page, text);
  await page.waitForTimeout(400); // autocomplete render pause
}

// Type into the already-focused element (no click). Selects-all first so
// prefilled values (e.g. "0") get replaced instead of appended to.
export async function typeText(page, text) {
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(80);
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: 0 });
    let d = 45 + Math.random() * 65; // 45-110ms base
    if (ch === ' ') d = 140;
    if (',.!?;:'.includes(ch)) d = 220 + Math.random() * 120;
    await page.waitForTimeout(d);
  }
}

// Replace-all fill with human timing (for qty/rate fields).
export async function humanFill(page, selector, text) {
  await humanClick(page, selector);
  await typeText(page, text);
  await page.waitForTimeout(250);
}

// Open a dropdown/combobox trigger and pick an option, with retries.
// Verifies the listbox opened (visible AND with options — hidden/stale
// menus don't count), prefers [role="option"] rows, verifies the pick
// by reading the trigger back.
export async function humanPickOption(page, trigger, optionText) {
  const menuOpen = () => page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10 || r.bottom < 0 || r.top > window.innerHeight) return false;
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
    };
    return [...document.querySelectorAll('[role="listbox"]')]
      .some((lb) => vis(lb) && lb.querySelector('[role="option"]'));
  });
  const readTrigger = () => page.evaluate(({ trigger, optionText }) => {
    if (!trigger.startsWith('text:')) {
      const el = document.querySelector(trigger);
      return el ? (el.innerText || '').trim() : null;
    }
    const hit = [...document.querySelectorAll('button')]
      .find((b) => (b.innerText || '').includes(optionText));
    return hit ? hit.innerText.trim() : null;
  }, { trigger, optionText });

  for (let attempt = 0; attempt < 3; attempt++) {
    if (!(await menuOpen())) {
      if (trigger.startsWith('text:')) await humanClickText(page, trigger.slice(5));
      else await humanClick(page, trigger);
      await page.waitForTimeout(700);
    }
    const box = await page.evaluate((optionText) => {
      const norm = (s) => (s || '').trim().replace(/\s+/g, ' ');
      const rows = [...document.querySelectorAll('[role="option"]')];
      const row = rows.find((el) => {
        const t = norm(el.innerText ?? el.textContent);
        if (!t.includes(optionText)) return false;
        const r = el.getBoundingClientRect();
        return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < window.innerHeight;
      });
      if (!row) return null;
      row.scrollIntoView({ block: 'nearest' });
      const r = row.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, optionText);
    if (box) {
      await humanMove(page, box.x, box.y);
      await page.waitForTimeout(120);
      await page.mouse.down();
      await page.waitForTimeout(60);
      await page.mouse.up();
      await page.waitForTimeout(600);
      await page.keyboard.press('Escape'); // menu may stay mounted; close it
      await page.waitForTimeout(300);
      const t = await readTrigger();
      if (t && t.includes(optionText)) return;
    } else {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  }
  throw new Error(`humanPickOption: could not pick "${optionText}"`);
}

// Native <select>: the menu is OS-rendered, no human can click it.
// Keep the cursor story (bezier move to the control), then select
// programmatically and verify the value stuck.
export async function humanSelect(page, selector, { value, label, index } = {}) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  if (!box) throw new Error(`humanSelect: no match ${selector}`);
  const opt = {};
  if (value !== undefined) opt.value = value;
  else if (label !== undefined) opt.label = label;
  else if (index !== undefined) opt.index = index;
  else throw new Error('humanSelect: need one of value/label/index');
  await humanMove(page, box.x, box.y);
  await page.waitForTimeout(150);
  const picked = await page.selectOption(selector, opt).catch(() => []);
  if (!picked.length) throw new Error(`humanSelect: option not found ${JSON.stringify(opt)}`);
  await page.waitForTimeout(300);
}

// Click by visible text. Matches the tightest-wrapping visible element
// to avoid portal parents.
export async function humanClickText(page, text, { exact = false } = {}) {
  const findBox = (t, ex) => page.evaluate(({ text, exact }) => {
    const norm = (s) => (s || '').trim().replace(/\s+/g, ' ');
    const cands = [];
    for (const el of document.querySelectorAll('button, a, li, [role="option"], span, div')) {
      const t = norm(el.innerText ?? el.textContent);
      if (!t) continue;
      const hit = exact ? t === text : t.includes(text);
      if (!hit) continue;
      if (!exact && t.length > text.length + 80) continue; // skip loose parents
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > window.innerHeight) continue;
      cands.push({ el, len: t.length });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a.len - b.len);
    const m = cands[0].el;
    m.scrollIntoView({ block: 'nearest' });
    const r = m.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, { text: t, exact: ex });
  const box = await findBox(text, exact);
  if (!box) throw new Error(`humanClickText: no match "${text}"`);
  const before = await domSnapshot(page);
  await humanMove(page, box.x, box.y);
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(250);
  let after = null;
  try { after = await domSnapshot(page); } catch { after = null; }
  if (!after || !domChanged(before, after)) {
    try {
      await page.evaluate(({ text, exact }) => {
      const norm = (s) => (s || '').trim().replace(/\s+/g, ' ');
      const cands = [];
      for (const el of document.querySelectorAll('button, a, li, [role="option"], span, div')) {
        const t = norm(el.innerText ?? el.textContent);
        if (!t) continue;
        const hit = exact ? t === text : t.includes(text);
        if (!hit) continue;
        if (!exact && t.length > text.length + 80) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > window.innerHeight) continue;
        cands.push({ el, len: t.length });
      }
      cands.sort((a, b) => a.len - b.len);
      if (cands.length) cands[0].el.click();
      }, { text, exact }).catch(() => {});
    } catch {}
  }
}
