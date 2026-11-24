const { dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const ROOT = '/sdcard';
const safeName = name => typeof name === 'string' && name.length > 0 && name !== '.' && name !== '..' && !/[\/\\\x00-\x1f\x7f]/u.test(name) && Buffer.byteLength(name) <= 255;
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const kind = entry => ({ 4: 'folder', 8: 'file' })[entry.type];

function explain(error) {
  const message = error.message || String(error);
  if (/ENOTEMPTY|directory not empty/i.test(message)) return '文件夹非空，已保留';
  if (/EACCES|EPERM|permission denied|read-only file system/i.test(message)) return '没有访问权限，或存储为只读';
  if (/ENOSPC|no space left/i.test(message)) return '存储空间不足';
  if (/EEXIST|file exists/i.test(message)) return '同名项目已存在，已跳过';
  if (/device offline|device .*not found|disconnected|socket.*closed/i.test(message)) return '设备已断开，请重新连接后重试';
  return message;
}

async function shell(adb, command, fallback) {
  if (adb.subprocess.shellProtocol) {
    const { exitCode, stderr } = await adb.subprocess.shellProtocol.spawnWaitText([command]);
    if (exitCode) throw new Error(stderr.trim() || fallback);
  } else {
    const result = await adb.subprocess.noneProtocol.spawnWaitText([command + ' && echo __LINKDESK_OK__']);
    if (!result.trimEnd().endsWith('__LINKDESK_OK__')) throw new Error(result.trim() || fallback);
  }
}

async function withFolder(manager, { device, parts }, work, connection) {
  if (typeof device !== 'string' || !device || !Array.isArray(parts) || !parts.every(safeName)) throw new Error('设备或目录无效');
  const client = connection?.client || await manager.getAdbClient();
  const adb = await client.createAdb(connection ? { transportId: connection.transportId } : { serial: device });
  try {
    const sync = await adb.sync();
    try {
      let dir = ROOT;
      for (const part of parts) {
        dir += '/' + part;
        if (kind(await sync.lstat(dir)) !== 'folder') throw new Error('目录已变更，请返回上一级');
      }
      await shell(adb, '[ -r ' + quote(dir) + ' ] && [ -x ' + quote(dir) + ' ]', '没有权限访问此目录');
      return await work({ adb, sync, dir });
    } finally { await sync.dispose().catch(() => {}); }
  } finally { await adb.close().catch(() => {}); }
}

async function entries({ sync, dir }) {
  return (await sync.readdir(dir)).filter(item => safeName(item.name) && kind(item)).map(item => ({
    name: item.name, kind: kind(item), size: Number(item.size), modified: Number(item.mtime) * 1000
  }));
}

async function upload({ adb, sync, dir }, source, name, meter) {
  const dest = quote(dir + '/' + name);
  const available = '[ ! -e ' + dest + ' ] && [ ! -L ' + dest + ' ]';
  await shell(adb, available, '同名项目已存在，已跳过');
  const temp = dir + '/.linkdesk-' + randomUUID() + '.part';
  const stat = await fs.promises.stat(source);
  if (!stat.isFile()) throw new Error('请选择普通文件');
  const input = fs.createReadStream(source);
  try {
    const stream = Readable.toWeb(input, {
      strategy: { highWaterMark: 256 * 1024, size: chunk => chunk.byteLength }
    }).pipeThrough(meter(stat.size));
    await sync.write({ filename: temp, file: stream, mtime: Math.floor(stat.mtimeMs / 1000) });
    await shell(adb, available + ' && mv -n ' + quote(temp) + ' ' + dest + ' && [ ! -e ' + quote(temp) + ' ]', '无法保存，目标可能已存在');
  } finally {
    input.destroy();
    await shell(adb, 'rm -f ' + quote(temp), '清理临时文件失败').catch(() => {});
  }
}

async function download({ sync, dir }, folder, name, meter) {
  if (process.platform === 'win32' && (/[<>:"|?*]|[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name))) throw new Error('此文件名不受 Windows 支持');
  const source = dir + '/' + name;
  const stat = await sync.lstat(source);
  if (kind(stat) !== 'file') throw new Error('仅可下载普通文件');
  const target = path.join(folder, name);
  const handle = await fs.promises.open(target, 'wx').catch(error => {
    if (error.code === 'EEXIST') throw new Error('同名项目已存在，已跳过');
    throw error;
  });
  try {
    await pipeline(Readable.fromWeb(sync.read(source).pipeThrough(meter(Number(stat.size)))), handle.createWriteStream());
  } catch (error) {
    await handle.close();
    await fs.promises.unlink(target).catch(() => {});
    throw error;
  } finally { await handle.close(); }
}

module.exports = function registerDeviceFiles(manager, getWindow) {
  let working = false;
  function handle(channel, fn) {
    ipcMain.handle('files:' + channel, async (event, request) => {
      try {
        const win = getWindow();
        if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('窗口已关闭');
        return { ok: true, ...await fn(request, win) };
      } catch (error) { return { ok: false, error: explain(error) }; }
    });
  }
  handle('list', request => withFolder(manager, request, async ctx => ({ entries: await entries(ctx) })));
  handle('change', async (request, win) => {
    if (working) throw new Error('请等待当前文件操作完成');
    working = true;
    try {
      const { action } = request;
      // Bind the operation to this connection before opening a native dialog.
      // A different phone could reconnect at the same Wi-Fi address.
      const client = await manager.getAdbClient();
      const source = (await client.getDevices(['device'])).find(item => item.serial === request.device);
      if (!source) throw new Error('设备已断开，请重新连接后重试');
      let names = request.names;
      let sources, destFolder;
      if (action === 'upload') {
        const picked = await dialog.showOpenDialog(win, { title: '选择要发送到手机的文件', properties: ['openFile', 'multiSelections'] });
        if (picked.canceled) return { canceled: true };
        sources = picked.filePaths;
        names = sources.map(file => path.basename(file));
      }
      if (!Array.isArray(names) || !names.length || !names.every(safeName)) throw new Error('文件名无效');
      if (action === 'download') {
        const picked = await dialog.showOpenDialog(win, { title: '选择电脑上的保存目录', properties: ['openDirectory', 'createDirectory'] });
        if (picked.canceled) return { canceled: true };
        [destFolder] = picked.filePaths;
      } else if (action === 'delete') {
        const location = [ROOT, ...request.parts].join('/');
        const { response } = await dialog.showMessageBox(win, {
          type: 'warning', message: '从手机永久删除 ' + names.length + ' 项？',
          detail: request.device + '  ·  ' + location + '\n\n' + names.slice(0, 8).join('\n') + (names.length > 8 ? '\n…' : '') + '\n\n此操作无法撤销。非空文件夹会保留。',
          buttons: ['取消', '永久删除'], defaultId: 0, cancelId: 0, noLink: true
        });
        if (response !== 1) return { canceled: true };
      } else if (action !== 'upload' && !(action === 'mkdir' && names.length === 1)) throw new Error('不支持的操作');
      return await withFolder(manager, request, async ctx => {
        const failures = [];
        for (const [index, name] of names.entries()) {
          const notify = (bytes, total) => {
            if (!win.isDestroyed()) win.webContents.send('files:progress', { device: request.device, action, name, index, count: names.length, bytes, total });
          };
          const meter = total => {
            let bytes = 0, last = 0;
            return new TransformStream({ transform(chunk, controller) {
              bytes += chunk.byteLength;
              if (Date.now() - last > 150 || bytes === total) { notify(bytes, total); last = Date.now(); }
              controller.enqueue(chunk);
            } });
          };
          notify(0, 0);
          try {
            const file = ctx.dir + '/' + name;
            if (action === 'upload') await upload(ctx, sources[index], name, meter);
            if (action === 'download') await download(ctx, destFolder, name, meter);
            if (action === 'mkdir') await shell(ctx.adb, 'mkdir ' + quote(file), '无法创建文件夹');
            if (action === 'delete') {
              const type = kind(await ctx.sync.lstat(file));
              if (!type) throw new Error('文件类型已变更');
              await shell(ctx.adb, (type === 'folder' ? 'rmdir ' : 'rm ') + quote(file), '无法删除此项目');
            }
          } catch (error) { failures.push({ name, reason: explain(error) }); }
        }
        return { count: names.length, failures };
      }, { client, transportId: source.transportId });
    } finally { working = false; }
  });
};
