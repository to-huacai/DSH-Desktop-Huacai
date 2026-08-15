

# DSH-Desktop-Huacai (DeepSeek Harness Desktop)

DeepSeek Harness 桌面应用程序，提供本地开发环境和插件管理功能。

## 项目简介

DSH-Desktop-Huacai 是一个基于 DeepSeek Harness 的桌面客户端应用，采用 C# 和 Node.js 技术栈构建，为用户提供可视化界面来管理和使用 DeepSeek 服务。

## 主要功能

- **启动器管理**：自动检测和启动 DeepSeek 服务端
- **插件系统**：支持编辑器插件 (dsh-editor) 和更新检查插件 (dsh-updater)
- **本地更新**：自动检查并下载最新版本更新
- **窗口管理**：支持多种窗口模式，包括闪屏界面和系统托盘
- **浏览器集成**：自动打开默认浏览器或指定浏览器访问应用界面
- **配置管理**：支持自定义端口、浏览器设置、退出时间等参数

## 技术架构

- **前端框架**：Windows Forms (C#) 桌面界面
- **后端服务**：Node.js 运行时
- **插件系统**：基于 @local 命名空间的本地插件架构
- **构建工具**：PowerShell 脚本 (build.ps1)

## 目录结构

```
├── src/
│   └── Launcher.cs           # 应用程序入口，启动器核心逻辑
├── tools/
│   ├── icon-gen.cs          # 图标生成工具
│   ├── zipdir.cs            # ZIP 打包工具
│   ├── test-mask-ui.cs      # UI 测试工具
│   └── test-editor-*.mjs    # 编辑器相关测试脚本
├── dsh-bundle/
│   ├── apply-update.mjs     # 更新应用脚本
│   ├── install-skin-plugin.mjs  # 皮肤安装脚本
│   └── plugin/
│       └── @local/
│           ├── dsh-editor/  # 编辑器插件
│           └── dsh-updater/ # 更新检查插件
├── build.ps1                # 构建脚本
└── run-test.ps1            # 测试脚本
```

## 构建要求

- .NET Framework / .NET SDK
- Node.js 运行时
- Windows 操作系统
- PowerShell 5.0+

## 快速开始

1. 克隆仓库：
```bash
git clone https://gitee.com/huacaicaicai/dsh-desktop-huacai.git
```

2. 执行构建脚本：
```powershell
.\build.ps1
```

3. 运行应用程序：
```powershell
dotnet run --project src
```

## 配置说明

通过 `Config` 类可配置以下参数：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| Port | 服务端口 | 8080 |
| OpenBrowser | 是否自动打开浏览器 | true |
| AppMode | 是否应用模式运行 | false |
| BrowserExe | 指定浏览器路径 | - |
| DshHome | DeepSeek Home 目录 | - |
| ExitAfterMs | 退出延迟时间(毫秒) | - |

## 插件开发

### dsh-editor 插件

提供在线编辑器功能，支持代码编辑、文件浏览等功能。

### dsh-updater 插件

负责检查和下载应用程序更新，确保用户始终运行最新版本。

## 开源协议

本项目遵循开源协议，具体信息请参考仓库中的 LICENSE 文件。

## 相关链接

- 项目地址：https://gitee.com/huacaicaicai/dsh-desktop-huacai
- DeepSeek 官网：https://deepseek.com
- 问题反馈：https://gitee.com/huacaicaicai/dsh-desktop-huacai/issues