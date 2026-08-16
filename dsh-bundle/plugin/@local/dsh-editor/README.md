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
  - **1.14 起显示行号**:编辑器左侧固定行号栏,随滚动同步,行号宽度随文件行数自动调整
  - **1.14 起图片文件可预览**:文件树显示 png/jpg/gif/webp/bmp/ico/avif 图片(带独立色点),
    点击后中间显示只读图片预览(透明背景棋盘格,保存按钮禁用)
- **右侧**:与默认模式完全一致的对话区,可正常与 agent 交流
  - 对话区顶部新增**会话切换条**:显示当前会话 + 会话数,点击弹出完整会话列表(按最近更新排序、多时可搜索),选中即切换;「+ 新会话」在当前项目新建会话(1.11)
- **切换**:侧边栏底部(设置上方)的「编辑器模式 / 返回对话模式」按钮;模式选择持久化(刷新/重启保留)

## 终端(1.12 内置面板;1.13 增加终端列表)

- **入口**:侧边栏底部「终端」按钮,对话/编辑器两种模式都可见;点击弹出 Qoder 式内置终端面板
  - PowerShell / CMD 一键切换、彩色输出、中文宽字符、滚轮回看历史;会话不随面板关闭中断
  - **1.13 起为 VS Code 式多终端**:顶部 Tab 栏(「+」新建 / 点 Tab 切换 / Tab「×」关闭终止),
    每个 Tab 一个独立会话(服务端按 `sid` 维护,上限 8);重开面板自动恢复 Tab 与输出
  - 打开目录跟随**当前选择的项目**:编辑器模式 → 文件树项目根;对话模式 → 当前会话所属工作区
  - 提示符 `PS 目录名>` / `C>`,光标紧贴提示符(修复 `CSI K/J` 无参数 erase 默认值等 emulator 缺陷)

## 实现

- `lib/index.js`(node half):提供文件 API 路由
  - `GET /dsh-editor/roots` — 列出工作区
  - `GET /dsh-editor/tree?root=` — 递归列出文件树(跳过 node_modules/.git/dist 等,深度/数量上限;1.14 起图片文件不再被跳过)
  - `GET /dsh-editor/file?root=&path=` — 读取文本(2MB 上限)
  - `GET /dsh-editor/image?root=&path=` — (1.14) 读取图片原始字节(仅限 png/jpg/gif/webp/bmp/ico/avif,30MB 上限,正确 content-type),供浏览器 `<img>` 预览
  - `POST /dsh-editor/file` — 写回文件
  - `POST /dsh-editor-terminal/open` — 在系统终端窗口打开工作区目录(Windows Terminal/cmd,`dryRun` 校验)
  - `WS /dsh-editor-terminal/ws` — 内置终端:ConPTY(node-pty)+ WS 中继,1.13 起 JSON 帧带 `sid`
    (`list/new/attach/init/input/resize/restart/close` ↔ `list/meta/hist/out/exit/err/removed`)
  - 路径仅限解析到 `workspaceRegistry` 中登记的工作区目录内,拒绝 `..`/绝对路径
- `lib/client.js`(browser half):编辑器模式 UI
  - `body.dsh-editor-mode` + 插件样式表把应用的三栏 grid 重排为 [文件树|(编辑器覆盖层)|对话],对话挪到右栏
  - 文件树占用单席位 slot `sidebar.workspaces`(仅编辑器模式下注册,退出即恢复原工作区浏览器)
  - 编辑器渲染在 `shell.overlay` 覆盖层,位于中间栏
    - **1.14 行号栏**:`.dsh-editor-gutter` 固定在编辑列左侧(宽度 CSS 变量,随行数位数自适应),
      highlight `<pre>` 与 `<textarea>` 右移同一宽度,滚动时行号与内容同步
    - **1.14 图片预览**:选中图片时渲染 `.dsh-editor-image-view`(棋盘格底 + 文件名),
      直接以 `/dsh-editor/image` 为 `<img src>`,不经过 JSON API
    - 会话切换条也渲染在 `shell.overlay`,固定在右栏对话区顶部:紧凑条显示当前会话,点击弹出下拉列表切换(过滤子代理/归档会话,多时可搜索);对话内容整体下移 44px 避免被遮挡(1.11)
  - 终端面板渲染在 `shell.overlay`(固定底部):Tab 栏 + 头部(PowerShell/CMD、重启、外部终端、关闭);
    每个会话一个独立 TermEmu,viewport 渲染当前 Tab;光标贴合提示符(snap 兜底)+ 行尾空白裁剪(1.13)
- 模式持久化:`localStorage['dsh.editor.mode']`

## 安装

随 DSH-Desktop-Huacai exe 内嵌,由 `install-skin-plugin.mjs` 的 companion 列表自动装入 web profile
(`~/.dsh/profiles/web/node_modules/@local/dsh-editor` + `cordis.patch.yml` 组合行)。
手动安装:

```bash
node install-skin-plugin.mjs   # 已把 dsh-editor 加入 COMPANIONS
```

卸载:删除组合行与 `node_modules/@local/dsh-editor` 目录后重启 dsh。
