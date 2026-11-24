// Screen coordinates and BrowserWindow bounds are in desktop logical pixels.
module.exports = function phoneResize(win, screen) {
  const chromeHeight = 76;
  let ratio = 0;
  let drag = null;
  let deferredRatio = null;

  function size(width, area) {
    const min = Math.max(200, (140 - chromeHeight) * ratio);
    const max = Math.min(area.width, (area.height - chromeHeight) * ratio);
    width = Math.max(min, Math.min(max, width));
    return { width: Math.round(width), height: Math.round(width / ratio) + chromeHeight };
  }
  function fit(next) {
    if (!Number.isFinite(next) || next < .1 || next > 10) return;
    if (drag) { deferredRatio = next; return; }
    if (ratio === next) return;
    ratio = next;
    const bounds = win.getBounds();
    win.setBounds({ ...bounds, ...size(bounds.width, screen.getDisplayMatching(bounds).workArea) }, false);
  }
  function pointer({ phase, edge, x, y }) {
    if (phase === 'end') {
      drag = null;
      if (deferredRatio !== null) { const next = deferredRatio; deferredRatio = null; fit(next); }
      return;
    }
    if (!ratio || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (phase === 'start' && /^(n|s|e|w|nw|ne|sw|se)$/.test(edge)) {
      const bounds = win.getBounds();
      drag = { edge, x, y, bounds, area: screen.getDisplayMatching(bounds).workArea, last: bounds.width };
      return;
    }
    if (!drag || phase !== 'move') return;
    const { bounds: b, area } = drag;
    const ex = drag.edge.includes('w') ? -1 : Number(drag.edge.includes('e'));
    const ey = drag.edge.includes('n') ? -1 : Number(drag.edge.includes('s'));
    // Project a corner drag onto the aspect-ratio diagonal without switching axes.
    const delta = (ex * (x - drag.x) + ey * (y - drag.y) / ratio) / (ex * ex + ey * ey / (ratio * ratio));
    const { width, height } = size(b.width + delta, area);
    if (width === drag.last) return;
    drag.last = width;
    win.setBounds({ x: b.x + (ex < 0 ? b.width - width : 0), y: b.y + (ey < 0 ? b.height - height : 0), width, height }, false);
  }
  return { fit, pointer };
};
