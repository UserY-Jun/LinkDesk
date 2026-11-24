const key = 'linkdesk.preferences.v1';
const ids = ['maxResolution', 'bitRate', 'maxFps', 'rotation', 'stayAwake', 'showTouches', 'powerOffOnClose', 'screenshotMode', 'startFolder', 'fileSort', 'hiddenFiles', 'refreshInterval'];

export function initPreferences(onChange) {
  const fields = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  const read = () => Object.fromEntries(ids.map(id => [id, fields[id].type === 'checkbox' ? fields[id].checked : fields[id].value]));
  const defaults = read();
  function apply(values) {
    for (const [id, field] of Object.entries(fields)) {
      const value = values?.[id];
      if (typeof defaults[id] === 'boolean') field.checked = typeof value === 'boolean' ? value : defaults[id];
      else field.value = [...field.options].some(option => option.value === value) ? value : defaults[id];
    }
  }
  try { apply(JSON.parse(localStorage.getItem(key))); } catch { apply(defaults); }
  const presets = document.querySelectorAll('[data-quality]');
  function highlight() {
    const current = [fields.maxResolution, fields.bitRate, fields.maxFps].map(field => field.value).join(',');
    presets.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.quality === current)));
  }
  function save(id) {
    highlight();
    let saved = true;
    try { localStorage.setItem(key, JSON.stringify(read())); } catch { saved = false; }
    onChange(id, saved);
  }
  for (const id of ids) fields[id].addEventListener('change', () => save(id));
  presets.forEach(button => button.onclick = () => {
    [fields.maxResolution.value, fields.bitRate.value, fields.maxFps.value] = button.dataset.quality.split(',');
    save('quality');
  });
  document.getElementById('resetSettings').onclick = () => { apply(defaults); save('reset'); };
  highlight();
  return read;
}
