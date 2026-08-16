# DSH-Desktop-Huacai (DeepSeek Harness Desktop)

DeepSeek Harness 桌面客户端 —— 自包含单文件启动器：内置 Node.js 运行时与 dsh 应用，**双击即用，目标电脑无需安装任何依赖**。

## 项目简介

DSH-Desktop-Huacai 是一个基于 DeepSeek Harness 的自包含桌面客户端。启动器（C# / Windows Forms）将便携版 Node.js 运行时、dsh 应用与插件打包进单个 exe，双击后自动完成解压、配置引导、插件安装与服务启动，并在浏览器中打开 dsh 界面。

## 主要功能

- **自包含免安装**：exe 内置便携版 Node.js 运行时与完整 dsh 应用，全程离线可用
- **一键启动**：双击 exe → 自动解压内置运行时（仅首次）→ 引导 profile → 安装插件 → 启动 dsh web → 打开界面
- **启动器管理**：自动检测与启动 DeepSeek 服务端；解压进度条 + 加载遮罩，不黑屏等待
- **自定义皮肤**：一键切换浅色主题，5 套预设主色调（粉/蓝/绿/紫/橙）+ 自定义取色器；可选照片背景（内置默认图或上传 ≤15MB）、半透明面板、AI 回复毛玻璃卡片；设置自动保存
- **归档管理**：侧边栏「归档」集中查看/恢复/彻底删除归档会话，与 dsh 原生操作实时联动
- **终端按钮**：侧边栏底部「终端」打开内置终端面板（Qoder 式，PowerShell/CMD 可切；1.13 起支持 VS Code 式多终端 Tab 列表），也可一键在系统终端（Windows Terminal/cmd）打开当前项目目录，对话模式与编辑器模式均可用
- **插件系统**：内置编辑器插件（dsh-editor）、更新检查插件（dsh-updater）等 @local 插件
- **应用内更新**：设置 → 通用设置中一键检查并更新 dsh 核心（npm 官方源，失败自动切换镜像），失败自动回滚
- **托盘驻留**：关闭窗口最小化到托盘，服务不中断；右键托盘可"打开界面"或"停止并退出"
- **浏览器集成**：支持无地址栏的应用窗口模式，或系统默认浏览器

## 技术架构

- **启动器**：C# / Windows Forms（.NET Framework 4.x，使用系统内置 csc 编译）
- **运行时**：内置便携版 Node.js（含 npm）
- **应用内核**：DeepSeek Harness（dsh）web 应用
- **插件系统**：基于 `@local` 命名空间的本地插件架构
- **构建工具**：PowerShell 脚本（build.ps1）+ 自举打包流程

## 目录结构

```
├── src/
│   └── Launcher.cs              # 启动器核心逻辑（C#）
├── tools/
│   ├── icon-gen.cs              # 图标生成工具
│   ├── zipdir.cs                # ZIP 打包工具
│   ├── pack-exe.mjs             # exe 组装脚本
│   ├── parse-payload.mjs        # 内嵌载荷解析/校验
│   └── test-*.{cs,mjs}          # 测试工具
├── dsh-bundle/
│   ├── apply-update.mjs         # 更新应用脚本
│   ├── install-skin-plugin.mjs  # 皮肤安装脚本
│   └── plugin/@local/
│       ├── dsh-editor/          # 编辑器插件
│       └── dsh-updater/         # 更新检查插件
├── build.ps1                    # 构建脚本（产出 exe）
├── run-test.ps1                 # 测试脚本
├── merge-exe-parts.bat          # 合并分卷，还原发布版 exe
├── DSH-Desktop-Huacai-1.13.exe.part1/.part2  # 发布版分卷（各 <100MB）
├── 使用说明.md / 更新文档.md / 新增功能说明.md
└── LICENSE
```

> 注：皮肤/归档插件不在仓库源码目录中，构建时由 build.ps1 从上一版 exe 的内嵌载荷继承（自举构建）。

## 获取发布版

Gitee 免费仓库单文件上限 100MB，发布版 exe（约 123MB）拆为两个分卷提交。获取方式：

```powershell
git clone https://gitee.com/huacaicaicai/dsh-desktop-huacai.git
cd dsh-desktop-huacai
# 合并分卷（也可直接双击 merge-exe-parts.bat）：
copy /b "DSH-Desktop-Huacai-1.13.exe.part1" + "DSH-Desktop-Huacai-1.13.exe.part2" "DSH-Desktop-Huacai-1.13.exe"
```

合并后双击 `DSH-Desktop-Huacai-1.13.exe` 即可运行（Windows 10/11，无需安装任何东西）。
> 合并前请确保该 exe 未在运行；分卷完整性已验证（合并哈希与原文件一致）。

## 从源码构建

构建机需要：Windows、.NET Framework 4.x（含系统 csc）、Node.js。

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1 -OutExe DSH-Desktop-Huacai-1.13.exe
```

脚本流程：提取上一版 exe 的内嵌插件（自举构建）→ 叠加 `dsh-bundle\` → 打包内置 Node 运行时 → 从 npx 缓存复制最新 dsh（或 `-FreshApp` 走 npm）→ 编译启动器 → 组装新 exe。
> 内嵌载荷布局或版本变化时，必须同步提升 `src\Launcher.cs` 中的 `EMBEDDED_VERSION`。

## 配置说明（launcher.json）

在 exe 同目录放一个 `launcher.json` 可覆盖默认值（可选）：

| 字段 | 说明 | 默认值 |
|------|------|--------|
| port | dsh web 端口 | 3080 |
| openBrowser | 就绪后自动打开界面 | true |
| appMode | 浏览器"应用窗口"模式（无地址栏） | true |
| browserExe | 指定浏览器 exe 完整路径（留空自动查找） | null |
| dshHome | DSH_HOME 目录（默认 ~/.dsh） | null |

## 内置功能（@local 插件）

五大内置功能（皮肤、归档、更新、编辑器模式、终端）均为 exe 内嵌的 @local 插件，首次启动自动装入 profile，开箱即用；数据（会话/工作区/密钥/设置）不受影响。

### 🎨 皮肤（浅色主题）

**入口：设置（左下角）→ 皮肤**

- 一键启用浅色主题；5 套预设主色调（粉/蓝/绿/紫/橙）+ 自定义取色器，配套悬停色、气泡色、面板底色自动衍生
- 可选**照片背景**：内置默认背景图，或上传本地图片（≤15MB）
- 半透明面板透明度调节（滑杆 0.15–0.95）；AI 回复毛玻璃卡片
- 设置自动保存至 `~/.dsh/dsh-skin.json`，刷新/重启均保留

### 📦 归档（归档会话管理）

**入口：侧边栏底部「归档」按钮（设置上方）**

- 集中查看所有已归档会话（标题、工作区、更新时间、运行状态），与别处归档/恢复/删除操作**实时联动刷新**
- **恢复**：一键将归档会话移回侧边栏原位置（幂等）
- **彻底删除**：输入标题确认后删除存档，不可恢复；运行中的会话双重保护（前端禁用 + 后端 409 校验）

### 📝 编辑器模式（dsh-editor）

**入口：侧边栏底部「编辑器模式」**，三栏布局（左侧文件树 + 中间编辑器 + 右侧对话），随时切回默认对话模式

- 文件树浏览/切换工作区；直接编辑文件，`Ctrl+S` 写回磁盘；未保存标记与切换确认
- 语法高亮支持 30+ 语言（JS/TS/Python/Rust/Go/Java/C/C++/C#/SQL/HTML/CSS/Shell/YAML 等），超大文件自动关闭高亮保证流畅
- 只读写当前工作区目录内的文件，路径越界防护

### 🖥️ 终端（1.12 新增；1.13 增加终端列表）

**入口：侧边栏底部「终端」**，对话模式与编辑器模式下均可见

- 点击弹出 **Qoder 式内置终端面板**（底部常驻栏），PowerShell/CMD 一键切换、彩色输出、中文宽字符、滚轮历史；会话不随面板关闭而中断
- **终端列表（1.13，参考 VS Code）**：顶部 Tab 栏，每个 Tab 一个独立终端会话——「+」新建、点 Tab 切换、Tab 上「×」关闭并终止；关闭面板不终止会话，重开自动恢复 Tab 与输出
- 面板内「外部终端」可在系统终端窗口（Windows Terminal/cmd）打开当前工作区目录
- **打开目录跟随当前选择的项目（1.13）**：编辑器模式定位到文件树项目根目录；对话模式定位到**当前会话所属工作区**（切换会话/项目后新开的终端跟随新项目）
- 1.13 修复提示符与光标间距：PowerShell 显示 `PS 目录名>`、cmd 显示 `C>`，光标紧贴提示符，不再出现大段空白
- ConPTY（node-pty）+ WebSocket 驱动，零新增依赖；后端从工作区注册表解析目录，不接受任意路径

### 🔄 应用内更新（dsh-updater）

**入口：设置 → 通用设置 →「DeepSeek Harness 更新」**

- 检查 npm 官方最新版（失败自动切换 npmmirror）；一键下载安装并自动重启，无需重装 exe
- 失败自动回滚旧版本；离线电脑仍可正常使用（仅无法在线更新）

## 文档

- 使用说明：`使用说明.md`
- 更新机制、重新构建步骤与常见问题：`更新文档.md`
- 本次桌面版新增功能：`新增功能说明.md`

## 开源协议

本项目遵循开源协议，具体信息请参考仓库中的 LICENSE 文件。

## 相关链接

- 项目地址：https://gitee.com/huacaicaicai/dsh-desktop-huacai
- DeepSeek 官网：https://deepseek.com
- 问题反馈：https://gitee.com/huacaicaicai/dsh-desktop-huacai/issues

