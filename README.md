<div align="center">

# NapCat-M

_Modern protocol-side framework implemented based on NTQQ._

</div>

---

> [!IMPORTANT]
> **本项目基于 [NapCatQQ](https://github.com/NapNeko/NapCatQQ)，是其停止维护后的延续分支。**
>
> 上游 `NapNeko/NapCatQQ` 于 2026-11-10 宣布 Ending，随后清空仓库内容并把历史重写为只剩 README 的孤儿提交，Releases 与 Tags 一并删除，原仓库既取不到源码也下不到安装包。
>
> NapCat-M 保存并延续了清空前的最后一份完整源码（上游提交 `72912f2`，对应 NapCat 4.18.4 / QQ 9.9.26-44498），并在此基础上继续维护：
>
> - 已完成一轮系统性修复：修复 Highway 上传、消息发送、配置损坏恢复、网络适配器生命周期、内存泄漏等 30+ 处上游遗留 bug 与安全漏洞，并通过全量 typecheck / lint / 测试回归
> - 后续版本将在本仓库 [Releases](https://github.com/Ming-QWQ520/NapCatQQ-M/releases) 发布
> - 源码基线与恢复过程：[FORK-NOTES.md](./FORK-NOTES.md)

> [!WARNING]
> 本项目是第三方 QQNT / OneBot 11 方案，不是官方 QQBot，账号存在风控与稳定性风险，**请使用专用小号**。
> QQ 客户端升级后注入协议可能失效，届时需要跟进 `packages/napcat-protocol` 与 `packages/napcat-native` 的适配。

## Feature

- **Easy to Use**
  - 作为初学者能够轻松使用.
- **Quick and Efficient**
  - 在低内存操作系统长时运行.
- **Rich API Interface**
  - 完整实现了大部分标准 OneBot 11 接口.
- **Actively Maintained**
  - 上游停维后由本仓库继续修复缺陷、跟进适配.

## 从这个仓库安装

### Windows

1. 到 [Releases](https://github.com/Ming-QWQ520/NapCatQQ-M/releases) 下载 `NapCat.Shell.Windows.OneKey.zip`。
2. 解压到任意目录，运行 `NapCatInstaller.exe`，解出 `NapCat.<build>.Shell` 目录。
3. 运行 `NapCat.<build>.Shell\napcat.bat`，它会拉起 QQ 并注入 NapCat。
4. 首次启动会打印 WebUI 地址与 token，浏览器打开 `http://127.0.0.1:6099/webui`，扫码登录专用 QQ 号。
5. 在 WebUI 的「网络配置」里添加 OneBot 服务（HTTP Server / WebSocket 均可）。
6. 验证：`POST http://127.0.0.1:<端口>/get_status` 能返回 JSON 即通。

安装器需要系统里已有 QQNT 客户端（9.9.x）。

### Linux / macOS

1. 到 [Releases](https://github.com/Ming-QWQ520/NapCatQQ-M/releases) 下载 `NapCat.Shell.Linux-macOS.zip`。
2. 把包里的 `napcat/` 放到 QQ 的 `resources/app/napcat`：
   - Linux：`/opt/QQ/resources/app`（deb / rpm），AppImage 为挂载后的 `squashfs-root/resources/app`
   - macOS：`/Applications/QQ.app/Contents/Resources/app`
3. 把该目录 `package.json` 的 `main` 改成 `./napcat/napcat.mjs`（改前先备份）。

macOS 还要重新签名，否则 QQ 拒绝启动：

```bash
sudo codesign --force --deep --sign - /Applications/QQ.app
```

数据目录：Linux `~/.config/QQ`，macOS `~/Library/Application Support/QQ`。
完整步骤见 [docs/INSTALL-Linux-macOS.md](./docs/INSTALL-Linux-macOS.md)。

不需要 Windows 那套 exe / dll——QQ 本身是 Electron，改了 `main` 就会先加载 NapCat。Windows 的 `NapCatWinBootMain.exe` 只是替你干这件事。

## 从源码构建

```bash
pnpm i
pnpm build:webui        # 先出前端，shell 会把它复制进 dist
pnpm build:shell        # 生成注入产物 napcat.mjs 等
pnpm build:framework
pnpm build:plugin-builtin
```

`pnpm-workspace.yaml` 的 `allowBuilds` 决定哪些依赖允许在安装期执行构建脚本。`esbuild`、`@swc/core`、`sharp`、`ttf2woff2`、`unrs-resolver`、`@heroui/shared-utils` 必须为 `true`，否则 vite 构建会失败。

`@homebridge/node-pty-prebuilt-multiarch` 默认 `false`：它的 postinstall 要从 GitHub Releases 拉预编译二进制，网络不可达时会退回本地 node-gyp 并在 Windows + Node 22 上 `spawn EINVAL`。它只服务 WebUI 的终端面板，不影响 QQ 消息收发。要用终端面板时，把该项改成 `true`，在网络可达的环境重新 `pnpm i`。

## 后期发展

本项目会以「可长期自维护」为目标持续演进，规划方向如下：

- **稳定性**
  - 持续排查并修复上游遗留缺陷，首批已完成 P0～P2 优先级的 30+ 处修复（崩溃、挂死、数据损坏、unhandled rejection 等）。
  - 补充回归测试覆盖，防止修复回退（已有 `packages/napcat-test`，持续扩充）。
- **兼容性**
  - 跟进 QQNT 客户端升级，维护 `napcat-protocol` / `napcat-native` 协议层适配，避免「QQ 一升级就失效」。
  - 保持 OneBot 11 接口兼容，对接框架无需改动。
- **安全**
  - 收敛鉴权、路径处理、请求体限制等攻击面；敏感比较逐步统一为常量时间实现。
- **工程化**
  - CI 流水线持续可用：push 到 main 自动执行 typecheck、测试与产物构建。
  - 依赖与构建链现代化，保持 `pnpm i` 到产物的构建路径顺畅。
- **文档与生态**
  - 补全安装、构建、二次开发文档；欢迎 Issue 反馈问题、PR 参与共建。

## Thanks

- [NapCatQQ](https://github.com/NapNeko/NapCatQQ) 及其全体贡献者 —— 本项目的全部基础
- [Lagrange](https://github.com/LagrangeDev/Lagrange.Core) 对本项目的大力支持 参考部分代码 已获授权

## License

本项目延续上游的混合协议开源，使用本项目时需要注意：

1. 第三方库代码或修改部分遵循其原始开源许可.
2. 本项目获取部分项目授权而不受部分约束
3. 项目其余逻辑代码采用[本仓库开源许可](./LICENSE).

**使用请遵守当地法律法规，由此造成的问题由使用者和提供违规使用教程者负责。**
