// Overlay injected into the recorded page: cursor, click ripple,
// title card and bottom-center caption pill.
//
// Runs via addInitScript (browser context — no imports, args only).
// The counter-zoom layer is load-bearing: when the page is zoomed
// (e.g. 90% for framing), a translate(x,y) on a plain fixed div renders
// at x*zoom — a drift that grows with distance from the top-left corner.
// The layer's inverse zoom keeps overlay coords in true viewport pixels.
export async function installOverlay({ font, zoomPercent }) {
  window.__mx = 640; window.__my = 100;
  const FONT = font || 'Inter, Arial, system-ui, sans-serif';
  document.addEventListener('DOMContentLoaded', () => {
    try { document.documentElement.style.zoom = `${zoomPercent || 90}%`; } catch {}
    const z = parseFloat(getComputedStyle(document.documentElement).zoom || '1') || 1;
    const layer = document.createElement('div');
    layer.id = '__reel_layer';
    layer.style.cssText = `position:fixed;inset:0;z-index:999999;pointer-events:none;zoom:${1 / z};`;
    document.body.appendChild(layer);

    const c = document.createElement('div');
    c.id = '__reel_cursor';
    // No CSS transition: the driver steps at ~40-60Hz, a transition would
    // make the dot perpetually chase one step behind the real mouse.
    c.style.cssText = `position:fixed;top:0;left:0;width:20px;height:20px;margin:-10px 0 0 -10px;border:2px solid #f59e0b;border-radius:50%;background:rgba(245,158,11,.18);pointer-events:none;transform:translate(640px,100px);`;
    layer.appendChild(c);

    document.addEventListener('mousedown', (e) => {
      const rip = document.createElement('div');
      rip.style.cssText = `position:fixed;top:${e.clientY}px;left:${e.clientX}px;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:rgba(245,158,11,.5);pointer-events:none;transition:all .45s ease-out;`;
      layer.appendChild(rip);
      requestAnimationFrame(() => { rip.style.transform = 'scale(3.2)'; rip.style.opacity = '0'; });
      setTimeout(() => rip.remove(), 500);
    });

    const title = document.createElement('div');
    title.id = '__reel_title';
    title.style.cssText = `position:fixed;left:50%;top:14%;transform:translateX(-50%);pointer-events:none;text-align:center;color:#fff;background:rgba(0,0,0,.72);font:600 20px/1.35 ${FONT};padding:14px 28px;border-radius:14px;opacity:0;transition:opacity .35s ease;max-width:80%;`;
    layer.appendChild(title);

    const cap = document.createElement('div');
    cap.id = '__reel_cap';
    cap.style.cssText = `position:fixed;left:50%;bottom:22px;transform:translateX(-50%);pointer-events:none;text-align:center;color:#fff;background:rgba(0,0,0,.55);font:500 13px/1.45 ${FONT};letter-spacing:.01em;padding:6px 14px;border-radius:8px;opacity:0;transition:opacity .25s ease;max-width:72%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
    layer.appendChild(cap);
  });
}
