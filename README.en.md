# DSH-Desktop-Huacai (DeepSeek Harness Desktop)

DeepSeek Harness desktop application, providing local development environment and plugin management features.

## Project Introduction

DSH-Desktop-Huacai is a desktop client application based on DeepSeek Harness, built using C# and Node.js technology stacks, providing users with a visual interface to manage and use DeepSeek services.

## Main Features

- **Launcher Management**: Automatically detect and start DeepSeek backend service
- **Plugin System**: Supports editor plugin (dsh-editor) and update check plugin (dsh-updater)
- **Local Update**: Automatically check and download latest version updates
- **Window Management**: Supports multiple window modes, including splash screen and system tray
- **Browser Integration**: Automatically open default browser or specified browser to access application interface
- **Configuration Management**: Supports customizing parameters such as port, browser settings, exit time, etc.

## Technical Architecture

- **Frontend Framework**: Windows Forms (C#) desktop interface
- **Backend Service**: Node.js runtime
- **Plugin System**: Local plugin architecture based on @local namespace
- **Build Tool**: PowerShell script (build.ps1)

## Directory Structure

```
├── src/
│   └── Launcher.cs           # Application entry, launcher core logic
├── tools/
│   ├── icon-gen.cs          # Icon generation tool
│   ├── zipdir.cs            # ZIP packaging tool
│   ├── test-mask-ui.cs      # UI test tool
│   └── test-editor-*.mjs    # Editor-related test scripts
├── dsh-bundle/
│   ├── apply-update.mjs     # Update apply script
│   ├── install-skin-plugin.mjs  # Skin installation script
│   └── plugin/
│       └── @local/
│           ├── dsh-editor/  # Editor plugin
│           └── dsh-updater/ # Update check plugin
├── build.ps1                # Build script
└── run-test.ps1            # Test script
```

## Build Requirements

- .NET Framework / .NET SDK
- Node.js Runtime
- Windows Operating System
- PowerShell 5.0+

## Quick Start

1. Clone repository:
```bash
git clone https://gitee.com/huacaicaicai/dsh-desktop-huacai.git
```

2. Execute build script:
```powershell
.\build.ps1
```

3. Run application:
```powershell
dotnet run --project src
```

## Configuration Instructions

The following parameters can be configured through the `Config` class:

| Parameter | Description | Default Value |
|------|------|--------|
| Port | Service Port | 8080 |
| OpenBrowser | Whether to automatically open browser | true |
| AppMode | Run in Application Mode | false |
| BrowserExe | Specify browser path | - |
| DshHome | DeepSeek Home Directory | - |
| ExitAfterMs | Exit delay time (milliseconds) | - |

## Plugin Development

### dsh-editor Plugin

Provides online editor functionality, supporting code editing, file browsing, etc.

### dsh-updater Plugin

Responsible for checking and downloading application updates, ensuring users always run the latest version.

## Open Source License

This project follows an open source license, for specific information please refer to the LICENSE file in the repository.

## Related Links

- Project Address: https://gitee.com/huacaicaicai/dsh-desktop-huacai
- DeepSeek Official Website: https://deepseek.com
- Issue Feedback: https://gitee.com/huacaicaicai/dsh-desktop-huacai/issues