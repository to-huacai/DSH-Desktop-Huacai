# @local/dsh-editor

DSH-Desktop-Huacai 内置「编辑器模式」插件。

## 功能

在 dsh web 界面中新增一个可切换的**编辑器模式**,与默认的对话(codex 风格)模式互斥切换:

```
┌─────────┬──────────────┬──────────┐
│  文件树  │  可编辑文件   │   对话    │
└─────────┴──────────────┴──────────┘
```

- **左侧**:当前工作区的文件树,目录可展开/折叠,点击文件打开
- **中间**:选中文件的内容,直接编辑;`Ctrl+S` 或「保存」按钮写回磁盘
- **右侧**:与默认模式完全一致的对话区,可正常与 agent 交流
  - 对话区顶部新增**会话切换条**:显示当前会话 + 会话数,点击弹出完整会话列表(按最近更新排序、多时可搜索),选中即切换;「+ 新会话」在当前项目新建会话(1.11)
- **切换**:侧边栏底部(设置上方)的「编辑器模式 / 返回对话模式」按钮;模式选择持久化(刷新/重启保留)

## 实现

- `lib/index.js`(node half):提供文件 API 路由
  - `GET /dsh-editor/roots` — 列出工作区
  - `GET /dsh-editor/tree?root=` — 递归列出文件树(跳过 node_modules/.git/dist 等,深度/数量上限)
  - `GET /dsh-editor/file?root=&path=` — 读取文本(2MB 上限)
  - `POST /dsh-editor/file` — 写回文件
  - 路径仅限解析到 `workspaceRegistry` 中登记的工作区目录内,拒绝 `..`/绝对路径
- `lib/client.js`(browser half):编辑器模式 UI
  - `body.dsh-editor-mode` + 插件样式表把应用的三栏 grid 重排为 [文件树|(编辑器覆盖层)|对话],对话挪到右栏
  - 文件树占用单席位 slot `sidebar.workspaces`(仅编辑器模式下注册,退出即恢复原工作区浏览器)
  - 编辑器渲染在 `shell.overlay` 覆盖层,位于中间栏
    - 会话切换条也渲染在 `shell.overlay`,固定在右栏对话区顶部:紧凑条显示当前会话,点击弹出下拉列表切换(过滤子代理/归档会话,多时可搜索);对话内容整体下移 44px 避免被遮挡(1.11)
- 模式持久化:`localStorage['dsh.editor.mode']`

## 安装

随 DSH-Desktop-Huacai exe 内嵌,由 `install-skin-plugin.mjs` 的 companion 列表自动装入 web profile
(`~/.dsh/profiles/web/node_modules/@local/dsh-editor` + `cordis.patch.yml` 组合行)。
手动安装:

```bash
node install-skin-plugin.mjs   # 已把 dsh-editor 加入 COMPANIONS
```

卸载:删除组合行与 `node_modules/@local/dsh-editor` 目录后重启 dsh。
