# Frame Player

跨平台视频播放器，支持 HLS（`.m3u8`）、浏览器可播放的视频直链及本地视频文件。播放列表保存在当前设备，不会上传视频内容。

## Web / PWA

```sh
npm install
npm run dev
```

在浏览器中访问 Vite 输出的本地地址。部署到 HTTPS 域名后，可从支持的浏览器安装为 PWA。

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

构建当前操作系统的安装包：

```sh
npm run desktop:build
```

HLS 播放要求媒体源允许跨域访问（CORS），且视频编码必须受目标设备支持。iOS 原生播放优先使用系统 HLS 能力。