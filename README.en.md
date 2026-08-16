# DSH-Desktop-Huacai (DeepSeek Harness Desktop)

A self-contained desktop client for DeepSeek Harness — a single-file launcher that bundles the Node.js runtime and the dsh app. **Double-click to run; no dependencies to install on the target machine.**

## Project Introduction

DSH-Desktop-Huacai is a self-contained desktop client built on DeepSeek Harness. The launcher (C# / Windows Forms) packages a portable Node.js runtime, the dsh application, and plugins into a single exe. On launch it automatically extracts the runtime, bootstraps the profile, installs plugins, starts the dsh web service, and opens the interface in a browser.

## Main Features

- **Self-contained, no install**: bundles a portable Node.js runtime and the full dsh app; fully usable offline
- **One-click start**: double-click the exe → extract the embedded runtime (first run only) → bootstrap profile → install plugins → start dsh web → open the UI
- **Launcher management**: automatically detects and starts the DeepSeek service; extraction progress bar + loading overlay, no blank waiting
- **Custom skins**: one-click light theme with 5 preset accent colors (pink/blue/green/purple/orange) + custom color picker; optional photo background (built-in default or upload ≤15MB), translucent panels, frosted-glass AI reply cards; settings auto-saved
- **Archive management**: the "Archive" panel in the sidebar for viewing/restoring/permanently deleting archived sessions, synced live with dsh's native operations
- **Terminal button**: a sidebar-foot [Terminal] button opens a system terminal (Windows Terminal, or cmd as fallback) rooted at the current workspace — available in both conversation mode and editor mode
- **Plugin system**: built-in editor plugin (dsh-editor), update-check plugin (dsh-updater) and other @local plugins
- **In-app updates**: one-click check and update of the dsh core from Settings → General (npm official registry, auto-switches mirror on failure), with automatic rollback
- **System tray**: closing the window minimizes to tray and the service keeps running; right-click the tray icon to "Open UI" or "Stop & Exit"
- **Browser integration**: supports an application-style window mode (no address bar) or the system default browser

## Technical Architecture

- **Launcher**: C# / Windows Forms (.NET Framework 4.x, compiled with the built-in csc)
- **Runtime**: embedded portable Node.js (with npm)
- **App core**: DeepSeek Harness (dsh) web application
- **Plugins**: local plugin architecture based on the `@local` namespace
- **Build tooling**: PowerShell scripts (build.ps1) + a self-bootstrapping packaging flow

## Directory Structure

```
├── src/
│   └── Launcher.cs              # Launcher core logic (C#)
├── tools/
│   ├── icon-gen.cs              # Icon generation tool
│   ├── zipdir.cs                # ZIP packaging tool
│   ├── pack-exe.mjs             # exe assembly script
│   ├── parse-payload.mjs        # Embedded payload parse/verify
│   └── test-*.{cs,mjs}          # Test tools
├── dsh-bundle/
│   ├── apply-update.mjs         # Update apply script
│   ├── install-skin-plugin.mjs  # Skin installation script
│   └── plugin/@local/
│       ├── dsh-editor/          # Editor + terminal plugin
│       └── dsh-updater/         # Update-check plugin
├── build.ps1                    # Build script (produces the exe)
├── run-test.ps1                 # Test script
├── merge-exe-parts.bat          # Recombine split parts back into the release exe
├── DSH-Desktop-Huacai-1.12.exe.part1/.part2  # Release exe split parts (each <100MB)
├── 使用说明.md / 更新文档.md / 新增功能说明.md  # Chinese docs (usage / updates / new features)
└── LICENSE
```

> Note: the skin/archive plugins are not in the repo source tree — build.ps1 inherits them from the previous exe's embedded payload (self-bootstrapping build).

## Getting the Release Build

Gitee free repositories cap single files at 100MB, so the ~123MB release exe is committed as two split parts:

```powershell
git clone https://gitee.com/huacaicaicai/dsh-desktop-huacai.git
cd dsh-desktop-huacai
# Recombine the parts (or simply double-click merge-exe-parts.bat):
copy /b "DSH-Desktop-Huacai-1.12.exe.part1" + "DSH-Desktop-Huacai-1.12.exe.part2" "DSH-Desktop-Huacai-1.12.exe"
```

Then double-click `DSH-Desktop-Huacai-1.12.exe` to run (Windows 10/11, nothing to install).
> Make sure the exe is not running before recombining; the parts have been verified (combined hash matches the original file).

## Building from Source

Build machine requirements: Windows, .NET Framework 4.x (with the built-in csc), Node.js.

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1 -OutExe DSH-Desktop-Huacai-1.12.exe
```

The script extracts the embedded plugins from the previous exe (self-bootstrapping build) → overlays `dsh-bundle\` → packages the embedded Node runtime → copies the latest dsh from the npx cache (or `-FreshApp` to install from npm) → compiles the launcher → assembles the new exe.
> Whenever the embedded payload layout or version changes, bump `EMBEDDED_VERSION` in `src\Launcher.cs` accordingly.

## Configuration (launcher.json)

Place a `launcher.json` next to the exe to override defaults (optional):

| Field | Description | Default |
|-------|-------------|---------|
| port | dsh web port | 3080 |
| openBrowser | Auto-open the UI when ready | true |
| appMode | Application window mode (no address bar) | true |
| browserExe | Full path to a browser exe (auto-detect if empty) | null |
| dshHome | DSH_HOME directory (default ~/.dsh) | null |

## Built-in Features (@local Plugins)

The five built-in features (skin, archive, update, editor mode, terminal) are all @local plugins embedded in the exe. They are installed into the profile automatically on first launch — out of the box. Your data (sessions/workspaces/keys/settings) is unaffected.

### 🎨 Skin (Light Theme)

**Entry: Settings (bottom-left) → Skin**

- One-click light theme; 5 preset accent colors (pink/blue/green/purple/orange) + custom color picker, with hover/bubble/panel colors derived automatically
- Optional **photo background**: built-in default image, or upload a local image (≤15MB)
- Translucent panel opacity slider (0.15–0.95); frosted-glass AI reply cards
- Settings auto-saved to `~/.dsh/dsh-skin.json`; persisted across refresh and restarts

### 📦 Archive (Archived Session Management)

**Entry: the "Archive" button at the bottom of the sidebar (above Settings)**

- Central view of all archived sessions (title, workspace, updated time, running state), **live-synced** with archive/restore/delete operations elsewhere
- **Restore**: move an archived session back to its original sidebar position with one click (idempotent)
- **Permanently delete**: confirm by typing the title, then the archive is removed and cannot be recovered; running sessions are double-protected (disabled in UI + 409 check on the backend)

### 📝 Editor Mode (dsh-editor)

**Entry: the "Editor Mode" button at the bottom of the sidebar** — three-pane layout (file tree on the left, editable file in the middle, conversation on the right), switch back to the default chat mode anytime

- Browse/switch workspaces in the file tree; edit files directly and save with `Ctrl+S`; unsaved-change markers and switch confirmation
- Syntax highlighting for 30+ languages (JS/TS/Python/Rust/Go/Java/C/C++/C#/SQL/HTML/CSS/Shell/YAML, etc.); auto-disabled for very large files to keep input smooth
- Reads/writes files only inside the current workspace directory, with path traversal protection

### 🖥️ Terminal (new in 1.12)

**Entry: the "Terminal" button at the bottom of the sidebar** — visible in both conversation mode and editor mode

- One click opens a system terminal window (Windows Terminal when installed, cmd otherwise) rooted at the current workspace directory
- Editor mode: opens at the file-tree project root; conversation mode: at the current session's workspace (falls back to the DSH home / user home)
- The terminal is an independent window that keeps running after the DSH UI/service exits; failures surface as a red toast in the UI

### 🔄 In-App Update (dsh-updater)

**Entry: Settings → General → "DeepSeek Harness Update"**

- Checks the latest npm release (auto-switches to npmmirror on failure); one-click download, install and restart — no need to re-download the exe
- Auto-rollback on failure; offline machines keep working normally (only online updates are unavailable)

## Documentation

- Usage guide (Chinese): `使用说明.md`
- Update mechanism, rebuild steps and FAQ (Chinese): `更新文档.md`
- New features of this release (Chinese): `新增功能说明.md`

## Open Source License

This project follows an open source license; see the LICENSE file in the repository for details.

## Related Links

- Project: https://gitee.com/huacaicaicai/dsh-desktop-huacai
- DeepSeek Official Website: https://deepseek.com
- Issue Feedback: https://gitee.com/huacaicaicai/dsh-desktop-huacai/issues

