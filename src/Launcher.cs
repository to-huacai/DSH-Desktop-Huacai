using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;

// ============================================================================
// DSH-Desktop-Huacai Launcher — self-contained DSH-Desktop-Huacai for Windows.
//
// What changed vs v1:
//   * embeds a portable Node.js runtime (runtime.zip) and the full dsh app
//     (app.zip) inside the DSHPAYLD overlay — no system Node.js required
//   * shows a splash window with "初始环境配置中..." + progress bar
//     immediately after double-click
//   * fully automatic: extract runtime → bootstrap profile → install bundled
//     plugins → start `dsh web` with the embedded node → open the browser UI
//   * keeps all v1 behaviors: payload overlay, skin/archive/editor plugin
//     install, web-frontend dist patch, browser app-mode window + centering,
//     AUMID
//
// Build: csc.exe /nologo /target:winexe /optimize /win32icon:app.ico
//        /reference:System.Windows.Forms.dll /reference:System.Drawing.dll
//        /reference:System.IO.Compression.dll
//        /reference:System.IO.Compression.FileSystem.dll
//        /reference:System.Web.Extensions.dll /out:shell.exe src\Launcher.cs
//
// Optional launcher.json next to the exe:
//   { "port": 3080, "openBrowser": true, "appMode": true,
//     "browserExe": null, "dshHome": null }
// Test-only CLI flags: --port <n> --dsh-home <dir> --no-browser
//                      --exit-after-ms <n> --skin-install-only
// ============================================================================

internal static class Program
{
    // ── constants ───────────────────────────────────────────────────────────
    private const string AUMID = "DeepSeekHarness.DSH-Desktop-Huacai";
    // Bump EMBEDDED_VERSION whenever the embedded payload layout or the
    // launcher's handling of it changes (re-extract on existing machines).
    private const string EMBEDDED_VERSION = "26";
    private const string RUNTIME_SUBDIR = "DSH-Desktop-Huacai";
    private const string PAYLOAD_MAGIC = "DSHPAYLD";
    private const int DEFAULT_PORT = 3080;
    private const int WIN_W = 1600;
    private const int WIN_H = 1000;

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    private static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);

    // ── config ──────────────────────────────────────────────────────────────
    private sealed class Config
    {
        public int Port = DEFAULT_PORT;
        public bool OpenBrowser = true;
        public bool AppMode = true;
        public string BrowserExe = null;
        public string DshHome = null;
        public int ExitAfterMs = 0;   // test hook: auto stop+exit after ready
    }

    private static Config cfg = new Config();

    // ── runtime state ───────────────────────────────────────────────────────
    private static SplashForm splash;
    private static Process serverProc;
    private static readonly object LogLock = new object();
    private static readonly StringBuilder LogBuffer = new StringBuilder();
    private static volatile bool shuttingDown;
    private static string readyUrl;

    // ── paths ───────────────────────────────────────────────────────────────
    private static string ExeDir()
    {
        string loc = Assembly.GetExecutingAssembly().Location;
        if (string.IsNullOrEmpty(loc)) return Directory.GetCurrentDirectory();
        return Path.GetDirectoryName(loc);
    }

    private static string LocalBaseDir()
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), RUNTIME_SUBDIR);
    }

    private static string SideBaseDir()
    {
        return ExeDir();
    }

    private static string NodeExePath()
    {
        string local = Path.Combine(LocalBaseDir(), "runtime", "node.exe");
        if (File.Exists(local)) return local;
        string side = Path.Combine(SideBaseDir(), "runtime", "node.exe");
        if (File.Exists(side)) return side;
        return null;
    }

    private static string AppBinPath()
    {
        string local = Path.Combine(LocalBaseDir(), "app", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
        if (File.Exists(local)) return local;
        string side = Path.Combine(SideBaseDir(), "app", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
        if (File.Exists(side)) return side;
        return null;
    }

    private static string DshHomeDir()
    {
        if (!string.IsNullOrEmpty(cfg.DshHome)) return cfg.DshHome;
        string env = Environment.GetEnvironmentVariable("DSH_HOME");
        if (!string.IsNullOrEmpty(env)) return env;
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".dsh");
    }

    private static string WebProfileDir()
    {
        return Path.Combine(DshHomeDir(), "profiles", "web");
    }

    private static string LogsDir()
    {
        return Path.Combine(LocalBaseDir(), "logs");
    }

    // ── logging ─────────────────────────────────────────────────────────────
    private static void FileLog(string line)
    {
        try
        {
            Directory.CreateDirectory(LogsDir());
            File.AppendAllText(Path.Combine(LogsDir(), "launcher.log"),
                "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + line + "\r\n", Encoding.UTF8);
        }
        catch { }
    }

    private static void AppendLog(string line)
    {
        lock (LogLock)
        {
            LogBuffer.AppendLine(line);
            if (LogBuffer.Length > 20000)
            {
                LogBuffer.Remove(0, LogBuffer.Length - 16000);
            }
            string text = LogBuffer.ToString();
            if (splash != null)
            {
                try { splash.BeginInvoke((Action)delegate { splash.PushLog(text); }); }
                catch { }
            }
        }
        FileLog(line);
    }

    private static void SetStatus(string text)
    {
        if (splash != null)
        {
            try { splash.BeginInvoke((Action)delegate { splash.SetStatus(text); }); }
            catch { }
        }
        FileLog("status: " + text);
    }

    private static void SetProgress(int percent)
    {
        if (splash != null)
        {
            try { splash.BeginInvoke((Action)delegate { splash.SetProgress(percent); }); }
            catch { }
        }
    }

    // ── payload (overlay) handling — same format as v1 ──────────────────────
    private static byte[] ReadPayloadFromSelf()
    {
        string location = Assembly.GetExecutingAssembly().Location;
        if (string.IsNullOrEmpty(location) || !File.Exists(location)) return null;
        byte[] array = File.ReadAllBytes(location);
        int n = array.Length;
        if (n < 32) return null;
        byte[] tail = new byte[16];
        Array.Copy(array, n - 16, tail, 0, 16);
        string magic = Encoding.ASCII.GetString(tail, 0, 8);
        if (magic != PAYLOAD_MAGIC) return null;
        long len = BitConverter.ToInt64(tail, 8);
        if (len <= 0 || len > n - 16) return null;
        byte[] payload = new byte[len];
        Array.Copy(array, n - 16 - len, payload, 0L, len);
        return payload;
    }

    private static Dictionary<string, byte[]> ParsePayload(byte[] payload)
    {
        Dictionary<string, byte[]> map = new Dictionary<string, byte[]>();
        if (payload == null || payload.Length < 4) return map;
        int off = 0;
        int count = BitConverter.ToInt32(payload, 0);
        off = 4;
        for (int i = 0; i < count; i++)
        {
            if (off + 8 > payload.Length) break;
            int nameLen = BitConverter.ToInt32(payload, off);
            off += 4;
            if (nameLen <= 0 || off + nameLen > payload.Length) break;
            string name = Encoding.UTF8.GetString(payload, off, nameLen);
            off += nameLen;
            if (off + 8 > payload.Length) break;
            long dataLen = BitConverter.ToInt64(payload, off);
            off += 8;
            if (dataLen < 0 || off + dataLen > payload.Length) break;
            byte[] data = new byte[dataLen];
            Array.Copy(payload, off, data, 0L, dataLen);
            off += (int)dataLen;
            map[name] = data;
        }
        return map;
    }

    /// <summary>Extract the embedded payload to %LOCALAPPDATA%\DSH-Desktop-Huacai
    /// when the version marker differs. The runtime/app zips are kept on disk
    /// here; they are deleted only after a successful unzip (EnsureRuntime /
    /// EnsureApp) so an interrupted first run can always re-extract.</summary>
    private static bool EnsureEmbedded()
    {
        try
        {
            string baseDir = LocalBaseDir();
            string markerPath = Path.Combine(baseDir, ".embedded");
            if (File.Exists(markerPath) && File.ReadAllText(markerPath).Trim() == EMBEDDED_VERSION)
            {
                // sanity: the big pieces must exist (or the zips must still be
                // around) or the state is broken and we force a re-extract
                if (NodeExePath() != null ||
                    File.Exists(Path.Combine(baseDir, "runtime.zip")) ||
                    File.Exists(Path.Combine(baseDir, "app.zip")))
                {
                    return true;
                }
                AppendLog("检测到不完整的内置组件状态, 重新解压...");
                try { File.Delete(markerPath); } catch { }
            }
            SetStatus("初始环境配置中...");
            AppendLog("正在解压内置组件 (首次运行)...");
            byte[] payload = ReadPayloadFromSelf();
            if (payload == null)
            {
                AppendLog("错误: 未找到 DSHPAYLD 覆盖层, exe 可能不完整。");
                return false;
            }
            Dictionary<string, byte[]> entries = ParsePayload(payload);
            if (entries.Count == 0)
            {
                AppendLog("错误: 覆盖层解析为空。");
                return false;
            }
            int total = entries.Count;
            int done = 0;
            foreach (KeyValuePair<string, byte[]> item in entries)
            {
                string rel = item.Key.Replace('/', Path.DirectorySeparatorChar);
                string full = Path.Combine(baseDir, rel);
                string dir = Path.GetDirectoryName(full);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                File.WriteAllBytes(full, item.Value);
                done++;
                if (done % 3 == 0 || done == total)
                {
                    SetProgress(done * 100 / total);
                    SetStatus(string.Format("初始环境配置中... ({0}/{1})", done, total));
                }
            }
            File.WriteAllText(markerPath, EMBEDDED_VERSION);
            AppendLog("内置组件解压完成: " + baseDir);
            return true;
        }
        catch (Exception ex)
        {
            AppendLog("解压内置组件失败: " + ex.Message);
            return false;
        }
    }

    /// <summary>Extract one zip with a real progress percentage.</summary>
    private static bool ExtractZipWithProgress(string zipPath, string destDir, string label)
    {
        try
        {
            if (!File.Exists(zipPath)) return false;
            Directory.CreateDirectory(destDir);
            using (ZipArchive archive = ZipFile.OpenRead(zipPath))
            {
                long total = 0L;
                foreach (ZipArchiveEntry e in archive.Entries) total += e.Length;
                long done = 0L;
                int lastPct = -1;
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    string name = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                    if (name.Length == 0 || name.EndsWith(Path.DirectorySeparatorChar.ToString())) continue;
                    if (name.IndexOf(".." + Path.DirectorySeparatorChar.ToString()) >= 0) continue;
                    string full = Path.Combine(destDir, name);
                    string dir = Path.GetDirectoryName(full);
                    if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                    using (Stream src = entry.Open())
                    using (FileStream dst = new FileStream(full, FileMode.Create, FileAccess.Write))
                    {
                        byte[] buf = new byte[65536];
                        int read;
                        while ((read = src.Read(buf, 0, buf.Length)) > 0)
                        {
                            dst.Write(buf, 0, read);
                            done += read;
                            int pct = (int)(done * 100 / Math.Max(1L, total));
                            if (pct != lastPct)
                            {
                                lastPct = pct;
                                if (pct % 5 == 0 || pct == 100)
                                {
                                    SetProgress(pct);
                                    SetStatus(string.Format("{0} ({1}%)", label, pct));
                                }
                            }
                        }
                    }
                }
            }
            SetProgress(100);
            return true;
        }
        catch (Exception ex)
        {
            AppendLog(label + " 失败: " + ex.Message);
            return false;
        }
    }

    private static bool EnsureRuntime()
    {
        string runtimeDir = Path.Combine(LocalBaseDir(), "runtime");
        string marker = Path.Combine(runtimeDir, ".dsh-version");
        if (File.Exists(Path.Combine(runtimeDir, "node.exe")) &&
            File.Exists(marker) && File.ReadAllText(marker).Trim() == EMBEDDED_VERSION)
        {
            return true;
        }
        string zip = Path.Combine(LocalBaseDir(), "runtime.zip");
        if (File.Exists(zip))
        {
            AppendLog("正在解压内置 Node.js 运行时...");
            if (!ExtractZipWithProgress(zip, runtimeDir, "正在解压内置 Node.js 运行时"))
            {
                return false;
            }
            File.WriteAllText(marker, EMBEDDED_VERSION);
            try { File.Delete(zip); } catch { }
            AppendLog("Node.js 运行时就绪 (" + Path.Combine(runtimeDir, "node.exe") + ")");
            return true;
        }
        // no embedded zip: side-by-side folder mode (runtime\ next to exe)
        return NodeExePath() != null;
    }

    private static bool EnsureApp()
    {
        string appDir = Path.Combine(LocalBaseDir(), "app");
        string marker = Path.Combine(appDir, ".dsh-version");
        if (File.Exists(AppBinPath()) &&
            File.Exists(marker) && File.ReadAllText(marker).Trim() == EMBEDDED_VERSION)
        {
            return true;
        }
        string zip = Path.Combine(LocalBaseDir(), "app.zip");
        if (File.Exists(zip))
        {
            AppendLog("正在解压内置 DSH 应用...");
            if (!ExtractZipWithProgress(zip, appDir, "正在解压内置 DSH 应用"))
            {
                return false;
            }
            File.WriteAllText(marker, EMBEDDED_VERSION);
            try { File.Delete(zip); } catch { }
            AppendLog("DSH 应用就绪 (" + AppBinPath() + ")");
            return true;
        }
        return AppBinPath() != null;
    }

    // ── profile + plugins ───────────────────────────────────────────────────
    /// <summary>Read the "version" field from a package.json. Returns null when
    /// the file is missing or has no version field (callers then fall back to a
    /// presence-only check).</summary>
    private static string PackageJsonVersion(string path)
    {
        try
        {
            if (!File.Exists(path)) return null;
            Match m = Regex.Match(File.ReadAllText(path), "\"version\"\\s*:\\s*\"([^\"]+)\"");
            return m.Success ? m.Groups[1].Value : null;
        }
        catch { return null; }
    }

    /// <summary>True when EVERY @local plugin bundled with this exe (under
    /// the extracted plugin\@local folder) is fully installed in the web
    /// profile: its package.json exists, its composition row is present in
    /// cordis.patch.yml, and (when the bundled package declares a version)
    /// the installed version matches the bundled one. Previously this
    /// checked only presence, so a profile installed by an older exe (older
    /// editor/skin/updater code) made the launcher skip the installer and the
    /// stale plugin survived — for example the 1.10 editor without the 1.11
    /// session list. Now any missing OR outdated bundled plugin triggers a
    /// rerun of the (idempotent, overwriting) installer.</summary>
    private static bool BundledPluginsInstalled()
    {
        try
        {
            string pluginRoot = Path.Combine(LocalBaseDir(), "plugin", "@local");
            if (!Directory.Exists(pluginRoot)) return true; // nothing bundled to check
            string profile = WebProfileDir();
            string patch = Path.Combine(profile, "cordis.patch.yml");
            if (!File.Exists(patch)) return false;
            string patchText = File.ReadAllText(patch);
            foreach (string dir in Directory.GetDirectories(pluginRoot))
            {
                string name = Path.GetFileName(dir);
                string bundledPkg = Path.Combine(dir, "package.json");
                if (!File.Exists(bundledPkg)) continue; // not a plugin
                string installedPkg = Path.Combine(profile, "node_modules", "@local", name, "package.json");
                if (!File.Exists(installedPkg)) return false;
                if (!patchText.Contains("@local/" + name)) return false;
                string bundledVersion = PackageJsonVersion(bundledPkg);
                if (bundledVersion != null)
                {
                    string installedVersion = PackageJsonVersion(installedPkg);
                    if (!string.Equals(bundledVersion, installedVersion, StringComparison.Ordinal)) return false;
                }
            }
            return true;
        }
        catch { return false; }
    }

    /// <summary>Run the bundled install-skin-plugin.mjs (embedded node) which
    /// bootstraps the profile and installs every bundled @local plugin
    /// (skin + archive companion). Rerun whenever any bundled plugin is
    /// missing; the installer is idempotent. Skipped when a server is
    /// already listening (never restart it).</summary>
    private static void EnsurePlugins()
    {
        try
        {
            if (IsServerUp(cfg.Port)) return;
            if (BundledPluginsInstalled())
            {
                AppendLog("内置插件已就绪, 跳过安装。");
                return;
            }
            string node = NodeExePath();
            string script = Path.Combine(LocalBaseDir(), "install-skin-plugin.mjs");
            if (node == null || !File.Exists(script)) return;
            SetStatus("正在引导 Web 配置 (安装内置插件)...");
            AppendLog("运行: " + node + " install-skin-plugin.mjs");
            ProcessStartInfo psi = new ProcessStartInfo(node, "\"" + script + "\"");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            psi.WorkingDirectory = LocalBaseDir();
            psi.EnvironmentVariables["DSH_HOME"] = DshHomeDir();
            psi.EnvironmentVariables["PATH"] = Path.GetDirectoryName(node) +
                Path.PathSeparator + Environment.GetEnvironmentVariable("PATH");
            Process p = Process.Start(psi);
            string stdout = p.StandardOutput.ReadToEnd();
            string stderr = p.StandardError.ReadToEnd();
            if (!p.WaitForExit(120000))
            {
                try { p.Kill(); } catch { }
                AppendLog("插件安装超时。");
                return;
            }
            foreach (string line in stdout.Replace("\r", "").Split('\n'))
            {
                if (line.Trim().Length > 0) AppendLog("  " + line.Trim());
            }
            foreach (string line in stderr.Replace("\r", "").Split('\n'))
            {
                if (line.Trim().Length > 0) AppendLog("  [stderr] " + line.Trim());
            }
            if (p.ExitCode != 0)
            {
                AppendLog("插件安装脚本退出码: " + p.ExitCode);
            }
        }
        catch (Exception ex)
        {
            AppendLog("插件安装失败: " + ex.Message);
        }
    }

    // ── server lifecycle ────────────────────────────────────────────────────
    private static bool IsServerUp(int port)
    {
        for (int i = 0; i < 10; i++)
        {
            try
            {
                using (TcpClient tcp = new TcpClient())
                {
                    tcp.Connect("127.0.0.1", port);
                    return true;
                }
            }
            catch { }
            Thread.Sleep(500);
        }
        return false;
    }

    private static bool WaitServerUp(int port, int seconds)
    {
        for (int i = 0; i < seconds * 2; i++)
        {
            if (shuttingDown) return false;
            try
            {
                using (TcpClient tcp = new TcpClient())
                {
                    tcp.Connect("127.0.0.1", port);
                    return true;
                }
            }
            catch { }
            if (serverProc != null && serverProc.HasExited)
            {
                AppendLog("dsh 进程已提前退出 (exit=" + serverProc.ExitCode + ")。");
                return false;
            }
            Thread.Sleep(500);
        }
        return false;
    }

    private static bool StartServer()
    {
        string node = NodeExePath();
        string bin = AppBinPath();
        if (node == null || bin == null)
        {
            AppendLog("错误: 未找到内置 Node 运行时或 dsh 应用 (node=" +
                (node ?? "null") + ", bin=" + (bin ?? "null") + ")。");
            return false;
        }
        string args = "\"" + bin + "\" web --port " + cfg.Port;
        AppendLog("启动服务: " + node + " " + args);
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(node, args);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            psi.WorkingDirectory = LocalBaseDir();
            psi.EnvironmentVariables["DSH_HOME"] = DshHomeDir();
            psi.EnvironmentVariables["DSH_DESKTOP"] = "1"; // tells in-app plugins they run from the launcher
            psi.EnvironmentVariables["PATH"] = Path.GetDirectoryName(node) +
                Path.PathSeparator + Environment.GetEnvironmentVariable("PATH");
            Process p = Process.Start(psi);
            serverProc = p;
            p.OutputDataReceived += delegate(object s, DataReceivedEventArgs e)
            {
                if (e.Data != null) AppendLog(e.Data);
            };
            p.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e)
            {
                if (e.Data != null) AppendLog("[stderr] " + e.Data);
            };
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            return true;
        }
        catch (Exception ex)
        {
            AppendLog("启动 dsh 进程失败: " + ex.Message);
            return false;
        }
    }

    private static void StopServer()
    {
        lock (LogLock)
        {
            Process p = serverProc;
            if (p == null) return;
            try
            {
                if (!p.HasExited)
                {
                    AppendLog("正在停止 DSH 服务 (PID " + p.Id + ")...");
                    ProcessStartInfo psi = new ProcessStartInfo("taskkill",
                        string.Format("/PID {0} /T /F", p.Id));
                    psi.UseShellExecute = false;
                    psi.CreateNoWindow = true;
                    psi.WindowStyle = ProcessWindowStyle.Hidden;
                    Process kill = Process.Start(psi);
                    if (kill != null) kill.WaitForExit(5000);
                    p.WaitForExit(3000);
                }
            }
            catch (Exception ex)
            {
                AppendLog("停止服务失败: " + ex.Message);
            }
            serverProc = null;
        }
    }

    // ── in-app update handoff (updater plugin → launcher) ─────────────────
    /// <summary>Watch the web server process for the whole launcher lifetime.
    /// When it exits on its own and an update-request.json exists (written by
    /// the @local/dsh-updater plugin), apply the update (npm install of the
    /// embedded app via the bundled apply-update.mjs) and restart the server —
    /// the new server stays inside this launcher's process tree, so tray
    /// "stop & exit" keeps working. Loops forever so a later update can
    /// trigger another handoff; stops on tray exit (shuttingDown).</summary>
    private static void StartServerMonitor()
    {
        Thread t = new Thread(delegate()
        {
            while (!shuttingDown)
            {
                Thread.Sleep(1500);
                Process p = serverProc;
                if (p == null || !p.HasExited) continue;
                if (shuttingDown) return;
                int code = 0;
                try { code = p.ExitCode; } catch { }
                lock (LogLock)
                {
                    if (serverProc == p) serverProc = null;
                }
                AppendLog("dsh 服务进程已退出 (exit=" + code + ")。");
                string req = Path.Combine(LocalBaseDir(), "update-request.json");
                if (File.Exists(req))
                {
                    ApplyUpdateAndRestart(req);
                }
                // keep looping: the next server exit is watched the same way
            }
        });
        t.IsBackground = true;
        t.Start();
    }

    /// <summary>Run the bundled apply-update.mjs with the embedded node, then
    /// restart the web server (success or failure — a failed npm install is
    /// rolled back by the script, so the previous version keeps running).</summary>
    private static void ApplyUpdateAndRestart(string reqPath)
    {
        try
        {
            string node = NodeExePath();
            string script = Path.Combine(LocalBaseDir(), "apply-update.mjs");
            if (node == null || !File.Exists(script))
            {
                AppendLog("更新失败: 找不到 apply-update.mjs (node=" + (node ?? "null") + ")。");
                try { File.Delete(reqPath); } catch { }
                RestartServerAfterUpdate();
                return;
            }
            SetStatus("正在更新 DSH 到新版本...");
            ShowMaskUi("正在更新 DSH 到新版本...");
            AppendLog("运行: " + node + " " + script + " " + reqPath);
            ProcessStartInfo psi = new ProcessStartInfo(node, "\"" + script + "\" \"" + reqPath + "\"");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            psi.WorkingDirectory = LocalBaseDir();
            psi.EnvironmentVariables["DSH_HOME"] = DshHomeDir();
            psi.EnvironmentVariables["PATH"] = Path.GetDirectoryName(node) +
                Path.PathSeparator + Environment.GetEnvironmentVariable("PATH");
            Process p = Process.Start(psi);
            string stdout = p.StandardOutput.ReadToEnd();
            string stderr = p.StandardError.ReadToEnd();
            if (!p.WaitForExit(600000))
            {
                try { p.Kill(); } catch { }
                AppendLog("更新脚本超时 (10 分钟)。");
            }
            foreach (string line in stdout.Replace("\r", "").Split('\n'))
            {
                if (line.Trim().Length > 0) AppendLog("  " + line.Trim());
            }
            foreach (string line in stderr.Replace("\r", "").Split('\n'))
            {
                if (line.Trim().Length > 0) AppendLog("  [stderr] " + line.Trim());
            }
            AppendLog(p.ExitCode == 0
                ? "更新成功, 正在重启 DSH 服务..."
                : "更新失败 (exit=" + p.ExitCode + "), 已恢复原版本, 正在重启...");
        }
        catch (Exception ex)
        {
            AppendLog("更新流程异常: " + ex.Message);
            try { File.Delete(reqPath); } catch { }
        }
        RestartServerAfterUpdate();
    }

    private static void RestartServerAfterUpdate()
    {
        try
        {
            if (shuttingDown) return;
            SetStatus("正在重启 DSH Web 服务...");
            ShowMaskUi("正在重启 DSH Web 服务...");
            if (!StartServer())
            {
                FailWithTail("更新后 DSH Web 服务启动失败。");
                return;
            }
            SetProgress(0);
            if (WaitServerUp(cfg.Port, 240))
            {
                readyUrl = readyUrlOf();
                AppendLog("DSH 已就绪: " + readyUrl);
                if (cfg.OpenBrowser)
                {
                    SetStatus("正在打开界面...");
                    ShowMaskUi("正在打开界面...");
                    OpenBrowser();
                }
                else
                {
                    HideMaskUi();
                }
            }
            else
            {
                FailWithTail("更新后服务 240 秒内未就绪, 请查看日志。");
            }
        }
        catch (Exception ex)
        {
            AppendLog("重启服务异常: " + ex.ToString());
        }
    }

    // ── browser (app-mode window, same as v1) ───────────────────────────────
    private static string FindBrowser()
    {
        string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string la = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string[] names = new string[]
        {
            "chrome.exe", "360chrome.exe", "qqbrowser.exe", "sogouexplorer.exe", "brave.exe",
            "opera.exe", "vivaldi.exe", "chromium.exe", "centbrowser.exe", "msedge.exe",
            "browser360.exe", "liebao.exe"
        };
        foreach (string name in names)
        {
            try
            {
                string v = (string)Microsoft.Win32.Registry.GetValue(
                    "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\" + name,
                    null, null);
                if (v != null && File.Exists(v)) return v;
            }
            catch { }
            try
            {
                string v = (string)Microsoft.Win32.Registry.GetValue(
                    "HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\" + name,
                    null, null);
                if (v != null && File.Exists(v)) return v;
            }
            catch { }
        }
        string[] rels = new string[]
        {
            "Google\\Chrome\\Application\\chrome.exe",
            "CentBrowser\\Application\\chrome.exe",
            "360Chrome\\Chrome\\Application\\360chrome.exe",
            "Tencent\\QQBrowser\\QQBrowser.exe",
            "SogouExplorer\\SogouExplorer.exe",
            "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
            "Opera\\opera.exe",
            "Vivaldi\\Application\\vivaldi.exe",
            "Chromium\\Application\\chrome.exe"
        };
        string[] roots = new string[] { pf86, pf };
        foreach (string rel in rels)
        {
            foreach (string root in roots)
            {
                string full = Path.Combine(root, rel);
                if (File.Exists(full)) return full;
            }
        }
        string edge = Path.Combine(pf, "Microsoft\\Edge\\Application\\msedge.exe");
        if (File.Exists(edge)) return edge;
        try
        {
            foreach (Process proc in Process.GetProcesses())
            {
                try
                {
                    string pn = proc.ProcessName.ToLower();
                    if (pn == "chrome" || pn == "msedge" || pn == "brave" || pn == "opera" ||
                        pn == "360chrome" || pn == "qqbrowser" || pn == "centbrowser" ||
                        pn == "chromium" || pn == "vivaldi" || pn == "sogouexplorer")
                    {
                        string file = proc.MainModule.FileName;
                        if (File.Exists(file)) return file;
                    }
                }
                catch { }
            }
        }
        catch { }
        return null;
    }

    private static IntPtr FindWindowOf(uint pid)
    {
        IntPtr result = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
        {
            if (!IsWindowVisible(hWnd)) return true;
            uint wpid;
            GetWindowThreadProcessId(hWnd, out wpid);
            if (wpid == pid)
            {
                result = hWnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return result;
    }

    private static string CenteredPosition()
    {
        int sw = Screen.PrimaryScreen.Bounds.Width;
        int sh = Screen.PrimaryScreen.Bounds.Height;
        int x = Math.Max(0, (sw - WIN_W) / 2);
        int y = Math.Max(0, (sh - WIN_H) / 2);
        return x + "," + y;
    }

    private static void OpenBrowser()
    {
        string url = "http://127.0.0.1:" + cfg.Port;
        AppendLog("打开界面: " + url);
        if (cfg.AppMode)
        {
            string browser = cfg.BrowserExe;
            if (string.IsNullOrEmpty(browser)) browser = FindBrowser();
            if (browser != null)
            {
                string profileDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "DSH\\BrowserProfiles",
                    Path.GetFileNameWithoutExtension(browser).ToLower());
                string args = "--user-data-dir=\"" + profileDir + "\" --app=" + url +
                    " --app-user-model-id=" + AUMID +
                    " --window-size=" + WIN_W + "," + WIN_H +
                    " --window-position=" + CenteredPosition() +
                    " --no-first-run --no-default-browser-check";
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo(browser, args);
                    psi.UseShellExecute = false;
                    Process p = Process.Start(psi);
                    if (p != null)
                    {
                        uint pid = (uint)p.Id;
                        IntPtr hwnd = IntPtr.Zero;
                        for (int i = 0; i < 150 && hwnd == IntPtr.Zero; i++)
                        {
                            Thread.Sleep(200);
                            hwnd = FindWindowOf(pid);
                        }
                        if (hwnd != IntPtr.Zero)
                        {
                            int sw = Screen.PrimaryScreen.Bounds.Width;
                            int sh = Screen.PrimaryScreen.Bounds.Height;
                            int x = Math.Max(0, (sw - WIN_W) / 2);
                            int y = Math.Max(0, (sh - WIN_H) / 2);
                            MoveWindow(hwnd, x, y, WIN_W, WIN_H, true);
                            ShowWindow(hwnd, 9);
                            MarkDesktopOpenedUi(); // 桌面端窗口已出现 -> 收起遮罩
                        }
                        else
                        {
                            AppendLog("30 秒内未检测到桌面端窗口, 可稍后点击\"打开界面\"重试。");
                            HideMaskUi(); // 打开尝试已结束, 收起遮罩让用户看到日志
                        }
                    }
                    else
                    {
                        HideMaskUi();
                    }
                    return;
                }
                catch (Exception ex)
                {
                    AppendLog("启动浏览器失败: " + ex.Message);
                    HideMaskUi();
                }
            }
        }
        try
        {
            Process.Start(url);
            MarkDesktopOpenedUi(); // 系统默认浏览器打开, 视为桌面端已打开
        }
        catch (Exception ex)
        {
            AppendLog("打开浏览器失败: " + ex.Message);
            HideMaskUi();
        }
    }

    // ── 遮罩层 UI 辅助(跨线程安全) ───────────────────────────────────────
    private static void ShowMaskUi(string text)
    {
        if (splash != null)
        {
            try { splash.ShowMask(text); } catch { }
        }
    }

    private static void HideMaskUi()
    {
        if (splash != null)
        {
            try { splash.HideMask(); } catch { }
        }
    }

    private static void MarkDesktopOpenedUi()
    {
        if (splash != null)
        {
            try { splash.MarkDesktopOpened(); } catch { }
        }
    }

    // ── pipeline ────────────────────────────────────────────────────────────
    private static void Pipeline()
    {
        try
        {
            if (!EnsureEmbedded()) { Fail("内置组件解压失败, 请重新下载完整的 DSH-Desktop-Huacai。"); return; }
            if (!EnsureRuntime()) { Fail("Node.js 运行时不可用。"); return; }
            if (!EnsureApp()) { Fail("DSH 应用不可用。"); return; }
            EnsurePlugins();
            if (IsServerUp(cfg.Port))
            {
                AppendLog("检测到 DSH 服务已在 " + readyUrlOf() + " 运行, 直接使用。");
            }
            else
            {
                SetStatus("正在启动 DSH Web 服务...");
                if (!StartServer())
                {
                    FailWithTail("DSH Web 服务启动失败。");
                    return;
                }
                SetStatus("正在等待服务就绪...");
                SetProgress(0);
                if (!WaitServerUp(cfg.Port, 240))
                {
                    FailWithTail("服务 240 秒内未就绪, 请查看日志。");
                    return;
                }
            }
            readyUrl = readyUrlOf();
            SetReady();
        }
        catch (Exception ex)
        {
            AppendLog("启动流程异常: " + ex.ToString());
            Fail("启动失败: " + ex.Message);
        }
    }

    private static string readyUrlOf()
    {
        return "http://127.0.0.1:" + cfg.Port;
    }

    private static void SetReady()
    {
        if (splash != null)
        {
            try { splash.BeginInvoke((Action)delegate { splash.Ready(readyUrl); }); }
            catch { }
        }
        AppendLog("DSH 已就绪: " + readyUrl);
        if (cfg.OpenBrowser)
        {
            SetStatus("正在打开界面...");
            ShowMaskUi("正在打开界面...");
            OpenBrowser();
        }
        if (cfg.ExitAfterMs > 0)
        {
            Thread t = new Thread(delegate()
            {
                Thread.Sleep(cfg.ExitAfterMs);
                if (splash != null)
                {
                    try { splash.BeginInvoke((Action)delegate { splash.StopAndExit(); }); }
                    catch { }
                }
            });
            t.IsBackground = true;
            t.Start();
        }
        StartServerMonitor();
    }

    private static void Fail(string message)
    {
        AppendLog("失败: " + message);
        if (splash != null)
        {
            try { splash.BeginInvoke((Action)delegate { splash.Failed(message); }); }
            catch { }
        }
    }

    private static void FailWithTail(string message)
    {
        string tail = LogTail(25);
        if (tail.Length > 0) message = message + "\n\n--- 最近日志 ---\n" + tail;
        Fail(message);
    }

    // ── legacy --skin-install-only mode ─────────────────────────────────────
    private static int SkinInstallOnlyMode()
    {
        if (!EnsureEmbedded())
        {
            MessageBox.Show("提取内置皮肤资源失败（请检查 exe 文件是否完整）。", "DSH-Desktop-Huacai",
                MessageBoxButtons.OK, MessageBoxIcon.Exclamation);
            return 1;
        }
        string node = NodeExePath();
        string script = Path.Combine(LocalBaseDir(), "install-skin-plugin.mjs");
        if (node == null || !File.Exists(script)) return 1;
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(node, "\"" + script + "\"");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            psi.WorkingDirectory = LocalBaseDir();
            psi.EnvironmentVariables["DSH_HOME"] = DshHomeDir();
            psi.EnvironmentVariables["PATH"] = Path.GetDirectoryName(node) +
                Path.PathSeparator + Environment.GetEnvironmentVariable("PATH");
            Process p = Process.Start(psi);
            string stdout = p.StandardOutput.ReadToEnd();
            string stderr = p.StandardError.ReadToEnd();
            p.WaitForExit(60000);
            FileLog("skin-install-only: exit=" + p.ExitCode + "\n" + stdout + stderr);
            if (p.ExitCode != 0)
            {
                MessageBox.Show("皮肤安装失败（exit=" + p.ExitCode + "）。详见 " +
                    Path.Combine(LogsDir(), "launcher.log"), "DSH-Desktop-Huacai",
                    MessageBoxButtons.OK, MessageBoxIcon.Exclamation);
                return 1;
            }
            return 0;
        }
        catch (Exception ex)
        {
            FileLog("skin-install-only exception: " + ex.ToString());
            return 1;
        }
    }

    // ── config loading ──────────────────────────────────────────────────────
    private static void LoadConfig()
    {
        try
        {
            string path = Path.Combine(ExeDir(), "launcher.json");
            if (!File.Exists(path)) return;
            JavaScriptSerializer jss = new JavaScriptSerializer();
            string text = File.ReadAllText(path, Encoding.UTF8);
            if (text.Length > 0 && text[0] == '\uFEFF') text = text.Substring(1); // strip UTF-8 BOM
            object obj = jss.DeserializeObject(text);
            Dictionary<string, object> map = obj as Dictionary<string, object>;
            if (map == null) return;
            object v;
            if (map.TryGetValue("port", out v)) cfg.Port = Convert.ToInt32(v);
            if (map.TryGetValue("openBrowser", out v)) cfg.OpenBrowser = Convert.ToBoolean(v);
            if (map.TryGetValue("appMode", out v)) cfg.AppMode = Convert.ToBoolean(v);
            if (map.TryGetValue("browserExe", out v) && v != null) cfg.BrowserExe = Convert.ToString(v);
            if (map.TryGetValue("dshHome", out v) && v != null) cfg.DshHome = Convert.ToString(v);
            if (map.TryGetValue("exitAfterMs", out v)) cfg.ExitAfterMs = Convert.ToInt32(v);
            AppendLog("已读取配置: " + path);
        }
        catch (Exception ex)
        {
            FileLog("配置读取失败(使用默认值): " + ex.Message);
        }
    }

    /// <summary>Last N lines of the in-memory log buffer (for error dialogs).</summary>
    private static string LogTail(int lines)
    {
        lock (LogLock)
        {
            string[] all = LogBuffer.ToString().Replace("\r\n", "\n").Split('\n');
            int start = Math.Max(0, all.Length - lines);
            StringBuilder sb = new StringBuilder();
            for (int i = start; i < all.Length; i++)
            {
                string line = all[i].TrimEnd();
                if (line.Length > 0) sb.AppendLine(line);
            }
            return sb.ToString().Trim();
        }
    }

    // ── entry point ─────────────────────────────────────────────────────────
    [STAThread]
    private static int Main(string[] args)
    {
        try { SetProcessDPIAware(); } catch { }

        LoadConfig();

        // CLI overrides (test hooks)
        if (args != null)
        {
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--skin-install-only") return SkinInstallOnlyMode();
                if (args[i] == "--port" && i + 1 < args.Length)
                {
                    int p;
                    if (int.TryParse(args[i + 1], out p) && p > 0 && p < 65536) cfg.Port = p;
                }
                if (args[i] == "--dsh-home" && i + 1 < args.Length) cfg.DshHome = args[i + 1];
                if (args[i] == "--no-browser") cfg.OpenBrowser = false;
                if (args[i] == "--exit-after-ms" && i + 1 < args.Length)
                {
                    int ms;
                    if (int.TryParse(args[i + 1], out ms)) cfg.ExitAfterMs = ms;
                }
            }
        }

        bool createdNew;
        Mutex mutex = new Mutex(true, "DSHDesktopHuacaiLauncher", out createdNew);
        if (!createdNew)
        {
            // another launcher instance owns the service; just open the UI
            if (IsServerUp(cfg.Port))
            {
                try { Process.Start("http://127.0.0.1:" + cfg.Port); } catch { }
            }
            return 0;
        }

        FileLog("=== DSH-Desktop-Huacai launcher start (port=" + cfg.Port + ", dshHome=" +
            DshHomeDir() + ") ===");

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        splash = new SplashForm();
        splash.SetStatus("初始环境配置中...");
        splash.Show();
        Thread pipeline = new Thread(Pipeline);
        pipeline.IsBackground = true;
        pipeline.Start();
        Application.Run(splash);
        StopServer();
        mutex.ReleaseMutex();
        return 0;
    }

    // =========================================================================
    // SplashForm — the "初始环境配置中..." window
    // =========================================================================
    private sealed class SplashForm : Form
    {
        private readonly Label titleLabel;
        private readonly Label subLabel;
        private readonly Label statusLabel;
        private readonly ProgressBar progress;
        private readonly TextBox logBox;
        private readonly Button openButton;
        private readonly Button exitButton;
        private NotifyIcon trayIcon;
        private readonly ContextMenuStrip trayMenu;
        private bool ready;
        private bool failed;
        private bool exitRequested;
        // "加载中" 遮罩层: 桌面端(浏览器界面)尚未打开时覆盖整个窗口
        private readonly Panel maskPanel;
        private readonly Label maskTitle;
        private readonly Label maskSub;
        private readonly TextBox maskLog;
        private readonly ProgressBar maskBar;
        private bool desktopOpened;

        public SplashForm()
        {
            Text = "DSH-Desktop-Huacai";
            ClientSize = new Size(640, 470);
            MinimumSize = new Size(560, 400);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            BackColor = Color.White;
            Font = new Font("Microsoft YaHei UI", 9F);

            titleLabel = new Label();
            titleLabel.Text = "DSH-Desktop-Huacai";
            titleLabel.Font = new Font("Microsoft YaHei UI", 18F, FontStyle.Bold);
            titleLabel.ForeColor = Color.FromArgb(22, 163, 74);
            titleLabel.AutoSize = true;

            subLabel = new Label();
            subLabel.Text = "DeepSeek Harness 桌面启动器 (内置 Node.js 运行时)";
            subLabel.ForeColor = Color.Gray;
            subLabel.AutoSize = true;

            statusLabel = new Label();
            statusLabel.Text = "初始环境配置中...";
            statusLabel.Font = new Font("Microsoft YaHei UI", 10.5F);
            statusLabel.ForeColor = Color.FromArgb(64, 64, 64);
            statusLabel.AutoSize = false;
            statusLabel.Size = new Size(600, 28);

            progress = new ProgressBar();
            progress.Style = ProgressBarStyle.Blocks;
            progress.Minimum = 0;
            progress.Maximum = 100;
            progress.Value = 0;

            logBox = new TextBox();
            logBox.Multiline = true;
            logBox.ReadOnly = true;
            logBox.ScrollBars = ScrollBars.Vertical;
            logBox.BackColor = Color.FromArgb(248, 248, 248);
            logBox.ForeColor = Color.FromArgb(80, 80, 80);
            logBox.Font = new Font("Consolas", 8.5F);
            logBox.BorderStyle = BorderStyle.FixedSingle;
            logBox.Text = "日志输出...\r\n";

            openButton = new Button();
            openButton.Text = "打开界面";
            openButton.Enabled = false;
            openButton.Size = new Size(110, 34);
            openButton.FlatStyle = FlatStyle.Flat;
            openButton.FlatAppearance.BorderColor = Color.FromArgb(22, 163, 74);
            openButton.ForeColor = Color.FromArgb(22, 163, 74);
            openButton.Click += delegate
            {
                if (!desktopOpened) ShowMask("正在打开界面...");
                OpenBrowser();
            };

            exitButton = new Button();
            exitButton.Text = "退出";
            exitButton.Size = new Size(110, 34);
            exitButton.FlatStyle = FlatStyle.Flat;
            exitButton.Click += delegate { RequestExit(); };

            Controls.Add(titleLabel);
            Controls.Add(subLabel);
            Controls.Add(statusLabel);
            Controls.Add(progress);
            Controls.Add(logBox);
            Controls.Add(openButton);
            Controls.Add(exitButton);

            titleLabel.Location = new Point(24, 20);
            subLabel.Location = new Point(26, 58);
            statusLabel.Location = new Point(24, 100);
            progress.Location = new Point(24, 136);
            progress.Size = new Size(592, 18);
            logBox.Location = new Point(24, 166);
            logBox.Size = new Size(592, 238);
            openButton.Location = new Point(24, 420);
            exitButton.Location = new Point(506, 420);

            // ── 加载中遮罩层: 桌面端尚未打开时, 覆盖整个窗口显示 "加载中" ──
            maskPanel = new Panel();
            maskPanel.Dock = DockStyle.Fill;
            maskPanel.BackColor = Color.FromArgb(248, 248, 248);
            maskPanel.Visible = false;

            maskTitle = new Label();
            maskTitle.Text = "加载中...";
            maskTitle.Font = new Font("Microsoft YaHei UI", 16F, FontStyle.Bold);
            maskTitle.ForeColor = Color.FromArgb(80, 80, 80);
            maskTitle.AutoSize = false;
            maskTitle.TextAlign = ContentAlignment.MiddleCenter;
            maskTitle.Size = new Size(560, 40);

            maskSub = new Label();
            maskSub.Text = "";
            maskSub.Font = new Font("Microsoft YaHei UI", 9.5F);
            maskSub.ForeColor = Color.FromArgb(120, 120, 120);
            maskSub.AutoSize = false;
            maskSub.Size = new Size(560, 24);
            maskSub.TextAlign = ContentAlignment.MiddleCenter;

            maskLog = new TextBox();
            maskLog.Multiline = true;
            maskLog.ReadOnly = true;
            maskLog.ScrollBars = ScrollBars.Vertical;
            maskLog.BackColor = Color.FromArgb(252, 252, 252);
            maskLog.ForeColor = Color.FromArgb(100, 100, 100);
            maskLog.Font = new Font("Consolas", 8.5F);
            maskLog.BorderStyle = BorderStyle.FixedSingle;
            maskLog.Text = "";
            maskLog.Size = new Size(560, 150);

            maskBar = new ProgressBar();
            maskBar.Style = ProgressBarStyle.Marquee;
            maskBar.MarqueeAnimationSpeed = 30;
            maskBar.Size = new Size(240, 12);

            maskPanel.Controls.Add(maskTitle);
            maskPanel.Controls.Add(maskSub);
            maskPanel.Controls.Add(maskLog);
            maskPanel.Controls.Add(maskBar);
            Controls.Add(maskPanel); // 最后加入 => 盖在最上层
            maskPanel.BringToFront();
            // 操作按钮保持位于遮罩之上, 加载期间仍可点击
            openButton.BringToFront();
            exitButton.BringToFront();
            // 尺寸变化时重新居中
            maskPanel.Resize += delegate { CenterMask(); };

            // tray
            trayMenu = new ContextMenuStrip();
            ToolStripMenuItem openItem = new ToolStripMenuItem("打开界面");
            openItem.Click += delegate
            {
                ShowWindow_();
                if (!desktopOpened) ShowMask("正在打开界面...");
                OpenBrowser();
            };
            ToolStripMenuItem stopItem = new ToolStripMenuItem("停止并退出");
            stopItem.Click += delegate { StopAndExit(); };
            trayMenu.Items.Add(openItem);
            trayMenu.Items.Add(stopItem);

            trayIcon = new NotifyIcon();
            trayIcon.Text = "DSH-Desktop-Huacai";
            try { trayIcon.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            trayIcon.ContextMenuStrip = trayMenu;
            trayIcon.DoubleClick += delegate { ShowWindow_(); };
            trayIcon.Visible = true;

            Shown += delegate
            {
                ShowMask("正在启动桌面端...");
                SetStatus("初始环境配置中...");
            };
        }

        private void ShowWindow_()
        {
            Show();
            WindowState = FormWindowState.Normal;
            BringToFront();
            Activate();
            if (!desktopOpened) ShowMask("正在启动桌面端...");
        }

        public void SetStatus(string text)
        {
            statusLabel.Text = text;
            if (maskPanel != null && maskPanel.Visible && maskSub != null)
            {
                maskSub.Text = text;
            }
        }

        public void SetProgress(int percent)
        {
            progress.Style = ProgressBarStyle.Blocks;
            if (percent < 0) percent = 0;
            if (percent > 100) percent = 100;
            progress.Value = percent;
        }

        /// <summary>居中摆放遮罩层内的标题/副标题/日志框/进度条。</summary>
        private void CenterMask()
        {
            if (maskPanel == null) return;
            int w = maskPanel.ClientSize.Width;
            int h = maskPanel.ClientSize.Height;
            if (w <= 0 || h <= 0) return; // 尚未布局, ShowMask 时会再次居中
            int cx = w / 2;
            // 整体纵向居中: 标题 + 副标题 + 日志框 + 进度条
            int total = maskTitle.Height + 8 + maskSub.Height + 10 + maskLog.Height + 16 + maskBar.Height;
            int top = Math.Max(8, (h - total) / 2);
            int y = top;
            maskTitle.Location = new Point(cx - maskTitle.Width / 2, y);
            y += maskTitle.Height + 8;
            maskSub.Location = new Point(cx - maskSub.Width / 2, y);
            y += maskSub.Height + 10;
            maskLog.Location = new Point(cx - maskLog.Width / 2, y);
            y += maskLog.Height + 16;
            maskBar.Location = new Point(cx - maskBar.Width / 2, y);
        }

        /// <summary>显示 "加载中" 遮罩层, 桌面端尚未打开时调用(线程安全)。</summary>
        public void ShowMask(string text)
        {
            if (InvokeRequired)
            {
                try { BeginInvoke((Action)delegate { ShowMask(text); }); } catch { }
                return;
            }
            maskSub.Text = text ?? "";
            maskPanel.Visible = true;
            maskPanel.BringToFront();
            openButton.BringToFront();
            exitButton.BringToFront();
            // 同步当前日志内容到遮罩层日志框
            if (maskLog != null)
            {
                maskLog.Text = logBox.Text;
                maskLog.SelectionStart = maskLog.TextLength;
                maskLog.ScrollToCaret();
            }
            CenterMask();
        }

        /// <summary>隐藏 "加载中" 遮罩层(桌面端已打开 / 失败时)。</summary>
        public void HideMask()
        {
            if (InvokeRequired)
            {
                try { BeginInvoke((Action)HideMask); } catch { }
                return;
            }
            if (maskPanel != null) maskPanel.Visible = false;
        }

        /// <summary>桌面端已打开: 记录状态并隐藏遮罩层。</summary>
        public void MarkDesktopOpened()
        {
            if (InvokeRequired)
            {
                try { BeginInvoke((Action)MarkDesktopOpened); } catch { }
                return;
            }
            desktopOpened = true;
            HideMask();
        }

        public void PushLog(string text)
        {
            logBox.Text = text;
            logBox.SelectionStart = logBox.TextLength;
            logBox.ScrollToCaret();
            // 遮罩层内的日志框同步显示启动文字(旧版窗口的日志区域)
            if (maskLog != null && maskPanel != null && maskPanel.Visible)
            {
                maskLog.Text = text;
                maskLog.SelectionStart = maskLog.TextLength;
                maskLog.ScrollToCaret();
            }
        }

        public void Ready(string url)
        {
            ready = true;
            failed = false;
            SetStatus("DSH 已就绪  " + url);
            SetProgress(100);
            statusLabel.ForeColor = Color.FromArgb(22, 163, 74);
            openButton.Enabled = true;
            openButton.Text = "打开界面";
            trayIcon.ShowBalloonTip(4000, "DSH-Desktop-Huacai", "DSH 服务已就绪: " + url,
                ToolTipIcon.Info);
            if (!Program.cfg.OpenBrowser)
            {
                // 不自动打开桌面端(测试/配置为 false): 直接收起遮罩露出就绪界面
                HideMask();
            }
        }

        public void Failed(string message)
        {
            HideMask(); // 失败时收起遮罩, 让错误与日志可见
            failed = true;
            ready = false;
            SetStatus("启动失败: " + message);
            statusLabel.ForeColor = Color.FromArgb(220, 60, 60);
            progress.Style = ProgressBarStyle.Blocks;
            progress.Value = 0;
            openButton.Enabled = false;
            trayIcon.ShowBalloonTip(5000, "DSH-Desktop-Huacai", message, ToolTipIcon.Error);
            MessageBox.Show(this, message + "\n\n详细日志: " + Path.Combine(LogsDir(), "launcher.log"),
                "DSH-Desktop-Huacai", MessageBoxButtons.OK, MessageBoxIcon.Exclamation);
        }

        private void RequestExit()
        {
            if (ready || failed)
            {
                DialogResult r = MessageBox.Show(this,
                    "确定要停止 DSH 服务并退出吗？", "DSH-Desktop-Huacai",
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (r != DialogResult.Yes) return;
                StopAndExit();
            }
            else
            {
                // startup still in progress: cancel
                DialogResult r = MessageBox.Show(this,
                    "启动仍在进行, 确定要取消并退出吗？", "DSH-Desktop-Huacai",
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (r != DialogResult.Yes) return;
                shuttingDown = true;
                StopServer();
                exitRequested = true;
                Close();
            }
        }

        public void StopAndExit()
        {
            shuttingDown = true;
            StopServer();
            exitRequested = true;
            Close();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (exitRequested)
            {
                trayIcon.Visible = false;
                trayIcon.Dispose();
                base.OnFormClosing(e);
                return;
            }
            if (ready && !failed)
            {
                // keep the server alive in the tray
                e.Cancel = true;
                Hide();
                trayIcon.ShowBalloonTip(3000, "DSH-Desktop-Huacai",
                    "DSH 服务仍在后台运行。右键托盘图标可打开界面或停止并退出。",
                    ToolTipIcon.Info);
                return;
            }
            // closing during startup/after failure: confirm
            DialogResult r = MessageBox.Show(this,
                "确定要退出吗？", "DSH-Desktop-Huacai",
                MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (r != DialogResult.Yes)
            {
                e.Cancel = true;
                return;
            }
            shuttingDown = true;
            StopServer();
            trayIcon.Visible = false;
            trayIcon.Dispose();
            base.OnFormClosing(e);
        }
    }
}
