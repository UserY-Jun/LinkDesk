import { createElement } from '../ui/dom.js';

const $ = id => document.getElementById(id);
const collator = new Intl.Collator('zh-CN', { numeric: true });
const date = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const verbs = { upload: '上传', download: '下载', delete: '删除', mkdir: '创建' };
function size(value) {
  if (value < 1024) return value + ' B';
  const power = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return Number((value / (1024 ** power)).toFixed(1)) + ' ' + ['B','KB','MB','GB','TB'][power];
}
export function initFiles(preferences, onBusy) {
  let target = '', visible = false, parts = [], rows = [], picked = new Set(), generation = 0;
  let loading = false, ready = false, error = '', job = null, resetFolder = false;
  const folderDialog = $('folderDialog'), search = $('fileSearch'), all = $('selectAll');
  const isBusy = () => Boolean(job);
  const allowed = () => target && ready && !job && !loading;
  function filtered() {
    const prefs = preferences(), find = search.value.toLocaleLowerCase();
    return rows.filter(row => (prefs.hiddenFiles || !row.name.startsWith('.')) && row.name.toLocaleLowerCase().includes(find))
      .sort((a,b) => {
        if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
        const diff = prefs.fileSort === 'modified' ? b.modified - a.modified : prefs.fileSort === 'size' ? b.size - a.size : 0;
        return diff || collator.compare(a.name, b.name);
      });
  }
  function controls(list) {
    const active = allowed(), count = picked.size;
    $('fileUpload').disabled = $('newFolder').disabled = !active;
    $('fileDelete').disabled = !active || !count;
    $('fileDownload').disabled = !active || !count || list.some(row => picked.has(row.name) && row.kind !== 'file');
    $('fileRefresh').disabled = !target || isBusy() || loading;
    $('folderUp').disabled = !target || !parts.length || isBusy();
    all.checked = list.length > 0 && count === list.length;
    all.indeterminate = count > 0 && count < list.length;
    all.disabled = !active || !list.length;
    $('fileSummary').textContent = count ? '已选 ' + count + ' 项，共 ' + list.length + ' 项' : list.length + ' 项';
  }
  function render() {
    $('fileNoDevice').hidden = Boolean(target);
    $('fileWorkspace').hidden = !target;
    const crumbs = $('breadcrumbs');
    crumbs.replaceChildren();
    ['内部共享存储', ...parts].forEach((name, i) => {
      if (i) crumbs.append(createElement('span', { text: '/' }));
      const button = createElement('button', { text: name });
      button.disabled = isBusy();
      button.onclick = () => load(parts.slice(0, i));
      crumbs.append(button);
    });
    const list = filtered(), names = new Set(list.map(row => row.name));
    picked = new Set([...picked].filter(name => names.has(name)));
    const body = document.createDocumentFragment();
    for (const row of list) {
      const tr = document.createElement('tr'), checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.checked = picked.has(row.name); checkbox.disabled = !allowed();
      checkbox.setAttribute('aria-label', '选择 ' + row.name);
      checkbox.onchange = () => { if (checkbox.checked) picked.add(row.name); else picked.delete(row.name); controls(list); };
      tr.insertCell().append(checkbox);
      const folder = row.kind === 'folder';
      const label = createElement(folder ? 'button' : 'span', { className: 'file-name ' + row.kind });
      label.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-' + (folder ? 'folder' : 'file') + '"/></svg>';
      label.append(document.createTextNode(row.name));
      if (folder) { label.disabled = isBusy(); label.onclick = () => load([...parts, row.name]); }
      tr.insertCell().append(label);
      tr.insertCell().textContent = folder ? '—' : size(row.size);
      tr.insertCell().textContent = row.modified ? date.format(row.modified) : '—';
      body.append(tr);
    }
    $('fileRows').replaceChildren(body);
    $('fileEmpty').hidden = Boolean(list.length);
    $('fileEmpty').textContent = loading ? '正在读取目录…' : error || (search.value ? '没有匹配的项目' : '此目录没有可见项目');
    controls(list);
  }
  async function load(next) {
    if (!target) return;
    const ticket = ++generation, device = target;
    if (JSON.stringify(next) !== JSON.stringify(parts)) search.value = '';
    parts = [...next]; picked.clear(); rows = []; loading = true; ready = false; error = ''; render();
    try {
      const result = await window.deviceFiles.list(device, parts);
      if (ticket !== generation) return;
      if (!result.ok) throw new Error(result.error);
      rows = result.entries; ready = true;
    } catch (err) {
      if (ticket === generation) error = '无法读取目录：' + err.message;
    } finally {
      if (ticket === generation) { loading = false; render(); }
    }
  }
  function sync(device, displayed) {
    const changed = target !== device;
    if (!changed && visible === displayed) return;
    const entering = !visible && displayed;
    visible = displayed;
    if (changed || (entering && resetFolder && !job)) {
      resetFolder = false;
      if (changed && !job) $('fileActivity').hidden = true;
      generation++; target = device; rows = []; picked.clear(); ready = false; loading = false; error = '';
      const start = preferences().startFolder;
      parts = start ? [start] : []; search.value = '';
      if (folderDialog.open) folderDialog.close();
    }
    if (target && visible && !job && (changed || entering)) void load(parts);
    else render();
  }
  const activity = $('fileActivity'), title = $('activityTitle'), details = $('activityDetails'), bar = $('activityProgress');
  window.deviceFiles?.onProgress(info => {
    if (!job || info.device !== job.device || info.action !== job.action) return;
    const bytes = info.total ? ' · ' + size(info.bytes) + ' / ' + size(info.total) : '';
    title.textContent = verbs[info.action] + ' · ' + info.name + '（' + (info.index + 1) + '/' + info.count + '）' + bytes;
    bar.max = info.count;
    bar.value = info.index + (info.total ? Math.min(1, info.bytes / info.total) : 0);
  });
  async function change(action, names = []) {
    if (!allowed()) return;
    job = { device: target, action }; const device = target, folder = [...parts];
    title.textContent = '正在' + verbs[action] + '…'; activity.hidden = false; details.replaceChildren(); bar.hidden = false; bar.removeAttribute('value');
    render(); onBusy();
    try {
      const result = await window.deviceFiles.change(device, folder, action, names);
      if (!result.ok) throw new Error(result.error);
      if (result.canceled) { activity.hidden = true; return; }
      const failed = result.failures.length;
      title.textContent = verbs[action] + '完成 · ' + (result.count - failed) + '/' + result.count + ' 项成功 · ' + device;
      if (failed) {
        const info = document.createElement('details');
        info.open = true;
        info.append(createElement('summary', { text: failed + ' 项未完成' }));
        result.failures.forEach(item => info.append(createElement('p', { text: item.name + '：' + item.reason })));
        details.append(info);
      }
      if (device === target && action !== 'download') await load(folder);
    } catch (err) {
      title.textContent = verbs[action] + '失败：' + err.message;
    } finally {
      job = null; bar.hidden = true; render(); onBusy();
      if (target && device !== target && visible) void load(parts);
    }
  }
  search.oninput = render;
  all.onchange = () => { picked = new Set(all.checked ? filtered().map(row => row.name) : []); render(); };
  $('folderUp').onclick = () => load(parts.slice(0,-1));
  $('fileRefresh').onclick = () => load(parts);
  $('fileUpload').onclick = () => change('upload');
  $('fileDownload').onclick = () => change('download', [...picked]);
  $('fileDelete').onclick = () => change('delete', [...picked]);
  $('newFolder').onclick = () => { $('folderName').value = ''; $('folderName').setCustomValidity(''); folderDialog.showModal(); $('folderName').focus(); };
  $('folderName').oninput = e => e.target.setCustomValidity('');
  $('folderForm').onsubmit = e => {
    e.preventDefault();
    const input = $('folderName'), value = input.value.trim();
    if (!value || value === '.' || value === '..' || /[\/\\\x00-\x1f\x7f]/.test(value)) {
      input.setCustomValidity('请输入有效的文件夹名称'); input.reportValidity(); return;
    }
    folderDialog.close(); void change('mkdir', [value]);
  };
  render();
  return { sync, isBusy, render, useStartFolderNextTime: () => { resetFolder = true; } };
}
