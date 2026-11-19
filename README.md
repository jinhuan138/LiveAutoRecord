[![License: LGPL v3](https://img.shields.io/badge/License-LGPL%20v3-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0) ![](https://img.shields.io/github/languages/top/WhiteMinds/trial-tower) ![](https://img.shields.io/github/issues/jinhuan138/LiveAutoRecord) ![](https://img.shields.io/npm/v/@autorecord/manager?label=%40autorecord%2Fmanager) ![](https://img.shields.io/github/v/release/jinhuan138/LiveAutoRecord?label=client) [![client-build](https://github.com/jinhuan138/LiveAutoRecord/actions/workflows/package_for_test.yml/badge.svg)](https://github.com/jinhuan138/LiveAutoRecord/actions/workflows/package_for_test.yml)

<div align="center">
  <div align="center">
    <img
      src="apps/electron/build/icons/256x256.png"
      alt="Logo"
      width="240"
    />
  </div>
  <h3 align="center">Live Auto Record</h3>
  <p align="center">支持多个直播平台的自动录制工具 / NPM 包</p>
  <div align="center">
    <a href="https://jinhuan138.github.io/LiveAutoRecord/"
      >使用文档</a
    >
    ·
    <a href="https://github.com/jinhuan138/LiveAutoRecord/issues"
      >Bug 反馈</a
    >
    ·
    <a href="https://github.com/jinhuan138/LiveAutoRecord/issues"
      >功能建议</a
    >
    ·
    <a href="https://github.com/WhiteMinds/LiveAutoRecord/tree/3.x"
      >旧版本</a
    >
  </div>
</div>
<br />

## 关于本项目

这是一个面向多个场景的开源项目

- 普通用户可以直接使用客户端版本来自动录制需要回顾的直播与弹幕
- 专业用户可以使用服务端部署来离线自动录制
- 开发者可以基于插件系统来扩展可用的直播平台，或基于 `@autorecord/manager` 包和已实现的直播平台插件来做一款新的软件

### Built With

<img src="https://img.shields.io/badge/pnpm-F69220?style=for-the-badge&logo=pnpm&logoColor=white" /> <img src="https://img.shields.io/badge/Turborepo-EF4444?style=for-the-badge&logo=turborepo&logoColor=white" /> <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" /> <img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" /> <img src="https://img.shields.io/badge/Vue.js-4FC08D?style=for-the-badge&logo=vue.js&logoColor=white" /> <img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" /> <img src="https://img.shields.io/badge/Electron-47848F?style=for-the-badge&logo=electron&logoColor=white" /> <img src="https://img.shields.io/badge/FFmpeg-007808?style=for-the-badge&logo=ffmpeg&logoColor=white" /> <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white" />

## 客户端

基于 Electron 整合了 `http-server` 与 `web` 的部分，并对一部分功能做原生化支持。

具有良好的键盘操作支持，预期上可以纯键盘操作。

[进入下载页](https://github.com/jinhuan138/LiveAutoRecord/releases/)

自动打包仅在本次推送前后 `apps/electron/package.json` 的 `version` 实际变化时执行，普通代码或依赖修改不会启动打包。`master` 分支升版本后，Windows `.exe` 和 macOS `.dmg` 打包成功会自动上传到本仓库 Releases，无需手动上传或配置额外 token；其他分支升版本只生成 Actions Artifacts。

需要测试时，可在 Actions 的 **Package for Test → Run workflow** 手动打包任意分支，手动运行只上传 Artifacts，不发布 Release。新分支首次推送或无法读取推送前版本时不自动打包，可手动测试。

发布版本取自客户端 `package.json`（如 `4.12.0` 对应 `v4.12.0`），发新版前需手动升级版本号。已发布版本不会被其他提交覆盖；同一版本发布运行的重跑可重新上传安装包。

#### 支持系统

- <img src="https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white" align="top" />
- <img src="https://img.shields.io/badge/mac%20os-000000?style=for-the-badge&logo=apple&logoColor=white" align="top" />
- 由于 linux 用户群体较少，没有尝试在系统此编译，但理论上可以支持。

#### 预览

<h5 align="center">录播任务列表</h5>

<div align="center"><img src="/readme-assets/1.png" width="720" /></div>

<details>
  <summary>点击查看更多 👉</summary>

<h5 align="center">新增录播任务</h5>

<div align="center"><img src="/readme-assets/5.png" width="720" /></div>

<h5 align="center">录播历史</h5>

<div align="center"><img src="/readme-assets/2.png" width="720" /></div>

<!-- #### 录播播放器 -->

<!-- ![](/readme-assets/3.png) -->

<h5 align="center">录播播放器-网页全屏</h5>

<div align="center"><img src="/readme-assets/4.png" width="720" /></div>

<h5 align="center">全局录播配置</h5>

<div align="center"><img src="/readme-assets/6.png" width="720" /></div>

</details>

#### 开发

```bash
# install dependencies
pnpm install

# dev electron (Turborepo auto-builds all dependencies)
pnpm app:dev

# build electron application for production
pnpm app:build
```

## 服务端部署

你可以通过下列命令来进行服务端部署：

```shell
# 克隆本仓库
git clone git@github.com:WhiteMinds/LiveAutoRecord.git && cd LiveAutoRecord
# 安装依赖
pnpm install
# 编译所有包（Turborepo 自动处理构建顺序）
pnpm build
# 启动服务端
pnpm -F @autorecord/http-server start
# 启动前端（也可以将前端 build 后通过 nginx 等方案来访问）
pnpm -F @autorecord/web preview
```

#### 开发

```bash
# install dependencies
pnpm install

# dev server (auto-builds dependencies via Turborepo)
pnpm dev:server
pnpm dev:web

# deployment for production
pnpm build
pnpm -F @autorecord/http-server start
pnpm -F @autorecord/web build # Start a web service using a tool such as nginx
```

## 作为 NPM 包引入

核心的包为 [@autorecord/manager](https://www.npmjs.com/package/@autorecord/manager)，该包实现了频道的模型，自动检查的调度等。

此外还要引入直播平台的支持插件或自己实现自定义的平台支持插件，已知的插件有如下：

- [@autorecord/douyu-recorder](https://www.npmjs.com/package/@autorecord/douyu-recorder)
- [@autorecord/bilibili-recorder](https://www.npmjs.com/package/@autorecord/bilibili-recorder)
- [@autorecord/huya-recorder](https://www.npmjs.com/package/@autorecord/huya-recorder)
- [@autorecord/douyin-recorder](https://www.npmjs.com/package/@autorecord/douyin-recorder)

你可以通过 `pnpm add @autorecord/manager` 或其他包管理器来引入它们。

下面是代码实例，另外 http-server 包也是通过 `@autorecord/manager` 和多个插件实现的，也可以作为开发时的参考。

### Example

```typescript
import { createRecorderManager } from '@autorecord/manager'
import { provider as providerForDouYu } from '@autorecord/douyu-recorder'

const manager = createRecorderManager({
  providers: [providerForDouYu],
  // ... other options ...
})
manager.addRecorder({
  providerId: providerForDouYu.id,
  channelId: '74751',
  quality: 'highest',
  streamPriorities: [],
  sourcePriorities: [],
  // ... other options ...
})
manager.startCheckLoop()
```

## 注意事项

软件默认使用 fmp4 格式进行录制，这是综合了抗损坏、实时查看等方面的考虑，如果使用此格式遇到问题，可以手动更换为其他格式。

## Road Map

- 完善弹幕播放器的 UI
- 完善错误处理
- 处理一些代码中的 TODO 项
- 提供文档
- 增加测试
- 简化服务端部署流程
- i18n
