// Keep the decoder, canvas and input listeners together when changing windows.
export function createPhoneWindow(stage, detachButton, dockButton) {
  const host = stage.parentElement;
  let floating = null;
  const canvas = stage.querySelector('canvas');
  let videoRatio = null;
  const fit = () => {
    if (!floating || !canvas.width || !canvas.height) return;
    const ratio = canvas.width / canvas.height;
    if (ratio === videoRatio) return;
    videoRatio = ratio;
    stage.style.setProperty('--video-ratio', String(ratio));
    window.windowControls.fitPhone(ratio);
  };
  const observer = new MutationObserver(fit);
  function restore() {
    observer.disconnect();
    videoRatio = null;
    host.insertBefore(stage, dockButton);
    dockButton.hidden = true;
    floating = null;
  }
  function dock() {
    const child = floating;
    if (!child) return;
    restore();
    if (!child.closed) child.close();
  }
  dockButton.addEventListener('click', dock);
  detachButton.addEventListener('click', () => {
    if (floating && !floating.closed) return floating.focus();
    const child = window.open('about:blank', 'phone-display', 'popup=yes,width=390,height=760');
    if (!child) return;
    floating = child;
    const doc = child.document;
    doc.title = '手机投屏';
    const css = doc.createElement('link');
    css.rel = 'stylesheet';
    css.href = new URL('css/workspace.css', document.baseURI).href;
    doc.head.append(css);
    doc.body.className = 'phone-window';
    stage.classList.remove('is-fullscreen');
    doc.body.append(stage);
    const bar = doc.createElement('header');
    bar.className = 'phone-titlebar';
    const title = doc.createElement('span');
    title.textContent = '手机投屏';
    bar.append(title);
    function button(label, symbol, action) {
      const el = doc.createElement('button');
      el.type = 'button';
      el.title = label;
      el.setAttribute('aria-label', label);
      el.textContent = symbol;
      el.addEventListener('click', action);
      bar.append(el);
      return el;
    }
    const pin = button('切换窗口置顶', '置顶', () => {
      const enabled = pin.getAttribute('aria-pressed') !== 'true';
      window.windowControls.pinPhone(enabled);
      pin.setAttribute('aria-pressed', String(enabled));
      pin.title = enabled ? '取消置顶' : '置顶';
    });
    pin.setAttribute('aria-pressed', 'false');
    button('最小化', '−', () => window.windowControls.minimizePhone());
    button('关闭浮窗，返回主窗口', '×', dock);
    doc.body.prepend(bar);
    for (const edge of ['n','s','e','w','ne','nw','se','sw']) {
      const grip = doc.createElement('div');
      grip.className = 'resize-grip';
      grip.dataset.edge = edge;
      grip.style.cursor = edge + '-resize';
      doc.body.append(grip);
      const send = (phase, e) => window.windowControls.resizePhone({ phase, edge, x: e.screenX, y: e.screenY });
      grip.onpointerdown = e => {
        if (e.button !== 0 || !e.isPrimary) return;
        e.preventDefault();
        grip.setPointerCapture(e.pointerId);
        send('start', e);
      };
      grip.onpointermove = e => { if (grip.hasPointerCapture(e.pointerId)) send('move', e); };
      grip.onpointerup = e => { if (grip.hasPointerCapture(e.pointerId)) send('move', e); };
      grip.onlostpointercapture = e => send('end', e);
    }
    child.addEventListener('blur', () => window.windowControls.resizePhone({ phase: 'end' }));
    child.addEventListener('keydown', e => {
      if (e.key === 'Escape') dock();
    });
    observer.observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
    fit();
    dockButton.hidden = false;
    child.addEventListener('pagehide', () => {
      if (floating === child) restore();
    }, { once: true });
  });
  window.addEventListener('beforeunload', dock, { once: true });
  return { dock };
}
