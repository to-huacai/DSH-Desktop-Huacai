# DSH-Desktop-Huacai (DeepSeek Harness Desktop)

DeepSeek Harness 桌面客户端 —— 自包含单文件启动器：内置 Node.js 运行时与 dsh 应用，**双击即用，目标电脑无需安装任何依赖**。

## 项目简介

DSH-Desktop-Huacai 是一个基于 DeepSeek Harness 的自包含桌面客户端。启动器（C# / Windows Forms）将便携版 Node.js 运行时、dsh 应用与插件打包进单个 exe，双击后自动完成解压、配置引导、插件安装与服务启动，并在浏览器中打开 dsh 界面。

## 主要功能

- **自包含免安装**：exe 内置便携版 Node.js 运行时与完整 dsh 应用，全程离线可用
- **一键启动**：双击 exe → 自动解压内置运行时（仅首次）→ 引导 profile → 安装插件 → 启动 dsh web → 打开界面
- **启动器管理**：自动检测与启动 DeepSeek 服务端；解压进度条 + 加载遮罩，不黑屏等待
- **插件系统**：内置编辑器插件（dsh-editor）、更新检查插件（dsh-updater），以及皮肤/归档等插件
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
├── DSH-Desktop-Huacai-1.11.exe.part1/.part2  # 发布版分卷（各 <100MB）
├── 使用说明.md / 更新文档.md / 新增功能说明.md
└── LICENSE
```

## 获取发布版

Gitee 免费仓库单文件上限 100MB，发布版 exe（约 123MB）拆为两个分卷提交。获取方式：

```powershell
git clone https://gitee.com/huacaicaicai/dsh-desktop-huacai.git
cd dsh-desktop-huacai
# 合并分卷（也可直接双击 merge-exe-parts.bat）：
copy /b "DSH-Desktop-Huacai-1.11.exe.part1" + "DSH-Desktop-Huacai-1.11.exe.part2" "DSH-Desktop-Huacai-1.11.exe"
```

合并后双击 `DSH-Desktop-Huacai-1.11.exe` 即可运行（Windows 10/11，无需安装任何东西）。
> 合并前请确保该 exe 未在运行；分卷完整性已验证（合并哈希与原文件一致）。

## 从源码构建

构建机需要：Windows、.NET Framework 4.x（含系统 csc）、Node.js。

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1 -OutExe DSH-Desktop-Huacai-1.11.exe
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

## 插件开发

### dsh-editor 插件
提供在线编辑器功能，支持代码编辑、文件浏览等。

### dsh-updater 插件
负责检查和下载 dsh 核心更新，确保用户始终运行最新版本。

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
