# @local/dsh-updater — DeepSeek Harness 更新检查插件（DSH-Desktop-Huacai）

在 dsh web 的 **设置 → 通用设置** 底部增加一行「DeepSeek Harness 更新」：

- **检查更新**：对比当前运行版本（内嵌 dsh 的 package.json）与 npm 官方 `latest`
  （`registry.npmjs.org` 优先，`registry.npmmirror.com` 兜底）。
- **一键更新**（仅 DSH-Desktop-Huacai 内置版可用）：写入 `update-request.json` 到
  `%LOCALAPPDATA%\DSH-Desktop-Huacai\` 并退出 web 服务 → **DSH-Desktop-Huacai 启动器接棒**：
  用内嵌 npm 执行 `apply-update.mjs`（备份旧包 → npm install 目标版本 →
  校验 → 失败自动回滚），然后自动重启服务。更新后的服务仍在启动器进程树内，
  托盘「停止并退出」照常工作。

## 接口

| 路由 | 说明 |
| --- | --- |
| `GET /dsh-updater/check` | `{ ok, mode, localVersion, latestVersion, latestPublishedAt, upToDate, canUpdate, error? }` |
| `POST /dsh-updater/update` | 可选 body `{ "version": "x.y.z" }`（缺省用 latest）；成功返回后约 0.8s 自动退出并交棒启动器 |

## 安装

随 DSH-Desktop-Huacai exe 捆绑，由 `install-skin-plugin.mjs` 的 COMPANIONS 一并安装到
profile（包复制到 `~/.dsh/profiles/web/node_modules/@local/dsh-updater/` +
`cordis.patch.yml` 组合行），重启 dsh 生效。也可单独：

```powershell
node install-skin-plugin.mjs --restart   # 在 exe 解压目录中运行
```

## 边界

- 非内置版（npx 缓存 / 全局安装 / 源码运行）只支持检查，不提供一键更新。
- 更新需要目标电脑能访问 npm registry（npmmirror 优先）。
- 更新的是内嵌 dsh 核心（`app\node_modules\@deepseek-ai\dsh`）；皮肤/归档等
  @local 插件位于 profile，不受影响。
