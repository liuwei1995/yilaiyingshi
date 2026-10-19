# 以来影视

跨平台视频播放器，支持 HLS（`.m3u8`）、浏览器可播放的视频直链及本地视频文件。播放列表保存在当前设备，不会上传视频内容。

## Web / PWA

```sh
npm install
npm run dev
```

开发模式通过 Vite 代理访问测试 API。测试环境构建使用 `npm run build:testing`；生产构建使用 `npm run build`。部署到 HTTPS 域名后，可从支持的浏览器安装为 PWA。

## Android

需要安装 Android Studio 和 Android SDK：

```sh
npm run cap:sync
npm run cap:android
```

在 Android Studio 中运行或构建 APK。

## iOS

需要 macOS、Xcode 和 CocoaPods：

```sh
npm run cap:sync
npm run cap:ios
```

在 Xcode 中选择签名团队后运行或归档。

## 桌面端

开发调试：

```sh
npm run electron:dev
```

在 Windows PowerShell 构建连接测试 API 的安装包：

```powershell
npm ci
npm run desktop:build:testing
```

构建连接生产 API 的 Windows 安装包：

```sh
npm run desktop:build
```

Windows 安装程序输出在 `release/`。生产命令读取 `.env.desktop-production`，测试命令读取 `.env.desktop-testing`。这两个环境文件以及 Web 环境文件分别配置在 `.env.production` 和 `.env.testing`。

`.env` 文件中的 API 地址均不含密钥；如果更换后端域名，修改对应环境文件后重新构建即可。当前 API 使用 HTTP，Electron 可请求，但部署为 HTTPS PWA 时浏览器会阻止 HTTP API 请求，需为 API 配置 HTTPS。

HLS 播放要求媒体源允许跨域访问（CORS），且视频编码必须受目标设备支持。iOS 原生播放优先使用系统 HLS 能力。