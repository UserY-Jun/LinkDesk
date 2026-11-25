# LinkDesk

LinkDesk 是基于 [scrcpy](https://github.com/Genymobile/scrcpy) 和 Electron 的 Android 设备工作台。通过 USB 或 Wi-Fi 连接后，可独立使用投屏和文件管理。

- **设备总览**：查看在线、离线和待授权的设备。设备行中的「投屏」启动会话，「文件」打开这台设备的共享存储。
- **屏幕投控**：操控手机、调整音量和截屏，也可以把画面移至独立窗口。在主窗口切换页面不会停止投屏。
- **文件管理**：浏览内部共享存储，多选上传、下载或删除，也可新建文件夹。下载时选择电脑上的目标目录；双向传输均跳过同名项目。删除需确认，只删除文件和空文件夹。
- **偏好设置**：投屏前可调整画质、方向、触摸点和熄屏行为；还可选择截屏保存方式、起始目录、排序、隐藏文件显示和设备刷新频率。设置自动保存在本机。

## 安装使用

### 下载预构建版本

在 [GitHub Releases](https://github.com/UserY-Jun/LinkDesk/releases) 查看已发布的安装包。如果没有适合当前系统的版本，可以从源码运行。

### 从源码运行

安装 Node.js 和 npm 后执行：

```bash
git clone https://github.com/UserY-Jun/LinkDesk.git
cd LinkDesk
npm ci
npm start
```

仓库已包含运行所需的资源：各平台的 ADB 位于 `resources/bin/`，推送到 Android 设备的服务端位于 `resources/scrcpy-server`。无需手动下载桌面版 scrcpy。

### 打包与提交

在目标系统上运行 `npm run build`，安装包会输出到 `release/`。启动和打包命令都会先从 `src/js/app.js` 生成渲染进程脚本，因此修改前端时请编辑源码。

推送到 `master` 后，[Release 工作流](https://github.com/UserY-Jun/LinkDesk/actions/workflows/release.yml) 会自动构建 Windows x64 安装包和 macOS 安装包（Intel、Apple Silicon 各一份）。登录 GitHub，打开对应运行记录，在 **Artifacts** 下载。也可点击 **Run workflow** 手动构建，手动运行还会打包 Linux。

正式发布时，先更新项目版本并提交，再推送对应的新版本标签（如 `v1.0.1`）。三个平台全部构建成功后，工作流会创建 GitHub Release 并附上安装包。当前工作流未配置 Windows 签名证书或 macOS 公证。

提交源码、运行资源和依赖锁文件 `package-lock.json`。自动生成的 `src/dist/`、安装包目录 `release/` 和本地依赖 `node_modules/` 已由 Git 忽略。

## 使用方法

### USB 连接

1. 使用 USB 数据线连接 Android 设备到电脑
2. 确保设备已开启 USB 调试模式
3. 允许设备调试授权
4. 在应用中点击"刷新"按钮，设备将显示在 USB 设备列表中
5. 如需调整画面，先打开「偏好设置」
6. 在设备旁点击「投屏」启动镜像，或点击「文件」管理存储

### 先插 USB，再用 Wi-Fi

1. 手机和电脑接入同一局域网。按上面的步骤连接 USB，并在手机上允许调试。
2. 保持插线，在「设备总览」点击手机旁的「启用 Wi-Fi」。这种方式无需打开手机的「无线调试」，也不需要配对码。
3. 应用会自动填入手机 IP。点击「连接」，看到 Wi-Fi 设备后即可拔线，选择「投屏」或「文件」。

仅仅插过 USB 不代表已经启用了 Wi-Fi 连接。启用后，只要手机的调试端口仍然开放，就能在「无线连接」输入手机当前 IP 重连（默认端口 5555）。手机重启后通常需要重新插线启用。

### 不用数据线：无线配对（Android 11 及以上）

1. 手机和电脑接入同一局域网。在手机「开发者选项」中打开「无线调试」，选择「使用配对码配对设备」。
2. 在应用的「无线连接」中选择「使用配对码配对」，输入手机配对弹窗显示的地址和六位码。
3. 若配对后设备没有自动出现，在「连接地址」输入手机**无线调试主页**上的 IP 和端口，点击「连接」。配对弹窗的端口只用于配对。

## 常见问题

### Q: 无法检测到设备？

A: 请确保：
- 设备已开启 USB 调试模式（开发者选项中）
- 已在设备上允许 USB 调试授权
- 使用的是数据线而非充电线
- 尝试更换 USB 端口或数据线

### Q: 无线连接失败？

A: 请检查：
- 设备和电脑在同一局域网
- 设备 IP 地址是否正确
- 防火墙是否阻止了连接
- 通过 USB 转 Wi-Fi 时，是否已在电脑的「设备总览」中点击「启用 Wi-Fi」；手机重启后可重新插线启用
- 通过无线配对时，手机的「无线调试」是否开启，连接时是否使用了无线调试主页上的端口

### Q: 投屏质量不佳？

A: 尝试调整以下参数：
- 降低分辨率（1280×720 通常是好的平衡点）
- 减小比特率（流畅度优先选择 2M）
- 降低帧率（选择 24 或 30）

## 系统要求

- **Windows**: Windows 10 64位 或更高版本
- **macOS**: macOS 10.15 (Catalina) 或更高版本
- **Linux**: 支持 scrcpy 的现代 Linux 分发版，如 Ubuntu 20.04+
- Android 设备需要 Android 5.0 (API 21) 或更高版本
- USB 数据线或同一局域网环境

## 技术栈

- Electron - 跨平台桌面应用框架
- scrcpy - Android 设备镜像和控制工具
- ADB (Android Debug Bridge) - 与 Android 设备通信

## 许可证

本项目基于 MIT 许可证开源。scrcpy 使用 [Apache License 2.0](https://github.com/Genymobile/scrcpy/blob/master/LICENSE)。

## 鸣谢

- [Genymobile/scrcpy](https://github.com/Genymobile/scrcpy) - 提供核心功能的优秀工具
- [electron](https://www.electronjs.org/) - 跨平台桌面应用框架 
