export function watchNearbyDevices({ root, view, refresh, onPick }) {
  let pending = false;
  let previous;
  root.textContent = '正在搜索附近设备…';
  const scan = async () => {
    if (pending || !view.open || document.hidden) return;
    pending = true;
    try {
      const services = await window.androidController.discoverWireless();
      services.sort((a, b) => a.kind.localeCompare(b.kind) || a.address.localeCompare(b.address));
      const snapshot = JSON.stringify(services);
      if (snapshot === previous) return;
      previous = snapshot;
      root.replaceChildren();
      if (!services.length) {
        root.textContent = '暂未发现附近设备。已通过 USB 启用 Wi-Fi 的手机，可直接用 IP 连接。';
      }
      for (const service of services) {
        const row = document.createElement('div');
        row.className = 'device-item';
        const label = document.createElement('span');
        label.textContent = service.name;
        const address = document.createElement('small');
        address.className = 'device-status';
        address.textContent = service.address;
        label.append(document.createElement('br'), address);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-secondary';
        button.textContent = service.kind === 'pairing' ? '输入配对码' : '连接';
        button.onclick = () => onPick(service);
        row.append(label, button);
        root.append(row);
      }
    } catch {
      previous = undefined;
      root.textContent = '自动搜索暂不可用，可手动填写配对或连接地址。';
    } finally {
      pending = false;
    }
  };
  const timer = window.setInterval(scan, 4000);
  refresh.addEventListener('click', scan);
  window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });
  return scan;
}
