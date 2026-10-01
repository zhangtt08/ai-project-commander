// AI Project Commander - Windows desktop launcher.
//
// Compiled with the .NET Framework 4 csc.exe that ships with Windows, referencing only
// System.Windows.Forms / System.Drawing / System.Management. No NuGet, no npm: the project
// stays dependency-free (ADR-001). The UI itself is rendered by the locally installed
// Microsoft Edge in --app mode (chromeless window), which is why no Electron is needed.
//
// What it does, in order:
//   1. owns its taskbar identity (SetCurrentProcessExplicitAppUserModelID)
//   2. single instance: a second double-click nudges the running one to show its window
//   3. probes /api/health; starts `node src/server/cli.js start` hidden only if needed
//   4. shows a splash while the server warms up, then opens the Edge app window
//   5. lives in the tray with 打开窗口 / 停止服务 / 退出 and kills its node child on exit
//
// Language level: C# 5 (the in-box csc only supports up to C# 5) - no string
// interpolation, no null-conditional operators, no auto-property initialisers.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Management;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// Explorer / taskbar file properties ("AI Project Commander" instead of the file name).
[assembly: AssemblyTitle("AI Project Commander")]
[assembly: AssemblyProduct("AI Project Commander")]
[assembly: AssemblyDescription("AI Project Commander 桌面启动器 (Edge app-mode + 本地 Node 服务)")]
[assembly: AssemblyCompany("Ztt")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace AIProjectCommander.Desktop
{
    /// <summary>P/Invoke surface. Only user32/shell32, both present on every Windows.</summary>
    internal static class Native
    {
        public const int SwRestore = 9;

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern int SetCurrentProcessExplicitAppUserModelID(string appID);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);

        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern uint GetShortPathName(string longPath, StringBuilder shortPath, uint bufferLength);

        public const uint WmClose = 0x0010;

        public static string TextOf(IntPtr hWnd)
        {
            var sb = new StringBuilder(512);
            GetWindowText(hWnd, sb, sb.Capacity);
            return sb.ToString();
        }

        public static string ClassOf(IntPtr hWnd)
        {
            var sb = new StringBuilder(512);
            GetClassName(hWnd, sb, sb.Capacity);
            return sb.ToString();
        }
    }

    /// <summary>File-system layout + a few tunables. Everything lives under &lt;root&gt;\data.</summary>
    sealed class LauncherConfig
    {
        public string Root;
        public string DataDir;
        public string DesktopDir;
        public string BrowserProfileDir;
        public string UrlFile;
        public string LogFile;
        public int Port = 8787;
        public int StartTimeoutSeconds = 150;   // first run seeds demo projects, so be patient

        public static LauncherConfig Load()
        {
            var cfg = new LauncherConfig();
            cfg.Root = ResolveProjectRoot();

            int port;
            string envPort = Environment.GetEnvironmentVariable("COMMANDER_PORT");
            if (!string.IsNullOrEmpty(envPort) && int.TryParse(envPort, NumberStyles.Integer, CultureInfo.InvariantCulture, out port) && port > 0)
                cfg.Port = port;

            cfg.DataDir = Environment.GetEnvironmentVariable("COMMANDER_DATA_DIR");
            if (string.IsNullOrEmpty(cfg.DataDir)) cfg.DataDir = Path.Combine(cfg.Root, "data");
            cfg.DesktopDir = Path.Combine(cfg.DataDir, "desktop");
            cfg.BrowserProfileDir = Path.Combine(cfg.DesktopDir, "browser");
            cfg.UrlFile = Path.Combine(cfg.DataDir, "server-url.txt");
            cfg.LogFile = Path.Combine(cfg.DesktopDir, "launcher.log");
            return cfg;
        }

        /// <summary>
        /// The exe normally sits in &lt;root&gt;\desktop, but a shortcut may launch it with any
        /// working directory, so walk up from both the exe location and the CWD.
        /// </summary>
        static string ResolveProjectRoot()
        {
            var starts = new List<string>();
            try { starts.Add(AppDomain.CurrentDomain.BaseDirectory); }
            catch (Exception) { }
            try { starts.Add(Directory.GetCurrentDirectory()); }
            catch (Exception) { }

            foreach (string start in starts)
            {
                DirectoryInfo dir = TryGetDir(start);
                for (int hop = 0; dir != null && hop < 5; hop++, dir = dir.Parent)
                {
                    if (File.Exists(Path.Combine(dir.FullName, "src", "server", "cli.js")))
                        return dir.FullName;
                }
            }
            throw new DirectoryNotFoundException(
                "找不到项目根目录（src\\server\\cli.js）。请把 AIProjectCommander.exe 放在项目 desktop\\ 目录下运行。");
        }

        static DirectoryInfo TryGetDir(string path)
        {
            try { return new DirectoryInfo(Path.GetFullPath(path)); }
            catch (Exception) { return null; }
        }

        public void EnsureDirectories()
        {
            Directory.CreateDirectory(DataDir);
            Directory.CreateDirectory(DesktopDir);
            Directory.CreateDirectory(BrowserProfileDir);
        }
    }

    /// <summary>Append-only diagnostics log so a failed launch is explainable after the fact.</summary>
    static class Log
    {
        static string path;
        static readonly object Gate = new object();

        public static void Init(string logPath) { path = logPath; }

        public static void Write(string message)
        {
            try
            {
                lock (Gate)
                {
                    if (string.IsNullOrEmpty(path)) return;
                    File.AppendAllText(path,
                        DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + "  " + message + Environment.NewLine,
                        Encoding.UTF8);
                }
            }
            catch (Exception)
            {
                // logging must never take the launcher down
            }
        }
    }

    /// <summary>Finds node.exe and msedge.exe without shelling out to `where`.</summary>
    static class ToolPaths
    {
        public static string FindNode()
        {
            string fromEnv = Environment.GetEnvironmentVariable("COMMANDER_NODE");
            if (!string.IsNullOrEmpty(fromEnv) && File.Exists(fromEnv)) return fromEnv;
            string found = SearchPath("node.exe");
            if (found != null) return found;
            return FirstExisting(
                Path.Combine(ProgramFiles, "nodejs", "node.exe"),
                Path.Combine(ProgramFilesX86, "nodejs", "node.exe"),
                Path.Combine(LocalAppData, "Programs", "nodejs", "node.exe"));
        }

        public static string FindEdge()
        {
            string found = FirstExisting(
                Path.Combine(ProgramFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(LocalAppData, "Microsoft", "Edge", "Application", "msedge.exe"));
            if (found != null) return found;
            found = SearchPath("msedge.exe");
            if (found != null) return found;
            return FromAppPaths("msedge.exe");
        }

        static string ProgramFiles
        {
            get { return Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles); }
        }

        static string ProgramFilesX86
        {
            get { return Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86); }
        }

        static string LocalAppData
        {
            get { return Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData); }
        }

        static string FirstExisting(params string[] candidates)
        {
            foreach (string c in candidates)
                if (!string.IsNullOrEmpty(c) && File.Exists(c)) return c;
            return null;
        }

        static string SearchPath(string exeName)
        {
            string raw = Environment.GetEnvironmentVariable("PATH");
            if (string.IsNullOrEmpty(raw)) return null;
            foreach (string dir in raw.Split(';'))
            {
                string trimmed = dir.Trim().Trim('"');
                if (trimmed.Length == 0) continue;
                try
                {
                    string candidate = Path.Combine(trimmed, exeName);
                    if (File.Exists(candidate)) return candidate;
                }
                catch (ArgumentException) { }
                catch (IOException) { }
            }
            return null;
        }

        static string FromAppPaths(string exeName)
        {
            try
            {
                using (var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(
                    @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + exeName))
                {
                    if (key == null) return null;
                    string value = key.GetValue(null) as string;
                    return (!string.IsNullOrEmpty(value) && File.Exists(value)) ? value : null;
                }
            }
            catch (Exception ex)
            {
                Log.Write("app paths lookup failed: " + ex.Message);
                return null;
            }
        }
    }

    /// <summary>Owns the local Node server: probe, start hidden, wait for /api/health, stop.</summary>
    sealed class ServerController
    {
        const string HealthPath = "/api/health";

        readonly LauncherConfig cfg;
        Process child;
        int childPid = -1;

        public string Url;

        public ServerController(LauncherConfig cfg)
        {
            this.cfg = cfg;
        }

        public bool OwnsChild
        {
            get { return child != null; }
        }

        public static bool Probe(string url, int timeoutMs)
        {
            if (string.IsNullOrEmpty(url)) return false;
            HttpWebResponse response = null;
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(url.TrimEnd('/') + HealthPath);
                request.Method = "GET";
                request.Timeout = timeoutMs;
                request.ReadWriteTimeout = timeoutMs;
                request.KeepAlive = false;
                request.Proxy = null;                 // never pay for WPAD on a loopback probe
                request.UserAgent = "AIProjectCommander-Desktop/1.0";
                response = (HttpWebResponse)request.GetResponse();
                if (response.StatusCode != HttpStatusCode.OK) return false;
                using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                {
                    string body = reader.ReadToEnd();
                    // routes.js answers {"data":{"ok":true,...}} - whitespace tolerant
                    return body.Replace(" ", string.Empty).IndexOf("\"ok\":true", StringComparison.Ordinal) >= 0;
                }
            }
            catch (WebException ex)
            {
                if (ex.Response != null) ex.Response.Close();
                return false;
            }
            catch (Exception)
            {
                return false;
            }
            finally
            {
                if (response != null) response.Close();
            }
        }

        public string ReadRecordedUrl()
        {
            try
            {
                if (!File.Exists(cfg.UrlFile)) return null;
                string text = File.ReadAllText(cfg.UrlFile, Encoding.UTF8).Trim();
                if (text.StartsWith("http", StringComparison.OrdinalIgnoreCase)) return text.TrimEnd('/');
            }
            catch (Exception ex)
            {
                Log.Write("server-url.txt unreadable: " + ex.Message);
            }
            return null;
        }

        /// <summary>
        /// Is a server already answering? The port auto-fallback means the real port may be
        /// anywhere in port..port+19, so the candidates are probed in parallel - doing it
        /// serially cost ~10s of cold start on this machine.
        /// </summary>
        public string FindExistingUrl()
        {
            string recorded = ReadRecordedUrl();
            if (recorded != null && Probe(recorded, 900)) return recorded;

            const int span = 20;
            string[] results = new string[span];
            int pending = span;
            using (ManualResetEvent done = new ManualResetEvent(false))
            {
                for (int i = 0; i < span; i++)
                {
                    int index = i;
                    string candidate = string.Format(CultureInfo.InvariantCulture, "http://127.0.0.1:{0}", cfg.Port + i);
                    Thread worker = new Thread(() =>
                    {
                        try { if (Probe(candidate, 600)) results[index] = candidate; }
                        finally { if (Interlocked.Decrement(ref pending) == 0) done.Set(); }
                    });
                    worker.IsBackground = true;
                    worker.Start();
                }
                done.WaitOne(2500);
            }

            for (int i = 0; i < span; i++)
                if (results[i] != null) return results[i];
            return null;
        }

        public bool IsUp()
        {
            if (Probe(Url, 900)) return true;
            string found = FindExistingUrl();
            if (found == null) return false;
            Url = found;
            return true;
        }

        public bool Start(Action<string> progress, out string error)
        {
            error = null;
            string node = ToolPaths.FindNode();
            if (node == null)
            {
                error = "找不到 node.exe。请安装 Node.js 22+，或设置 COMMANDER_NODE 指向 node.exe。";
                return false;
            }

            // Same trick as 启动.bat: drop the stale URL so we can tell a fresh bind from an old one.
            try { if (File.Exists(cfg.UrlFile)) File.Delete(cfg.UrlFile); }
            catch (Exception ex) { Log.Write("could not delete server-url.txt: " + ex.Message); }

            var psi = new ProcessStartInfo(node,
                string.Format(CultureInfo.InvariantCulture, "src/server/cli.js start --port {0}", cfg.Port));
            // cli.js derives dataDir from process.cwd(), so the working directory MUST be the root.
            psi.WorkingDirectory = cfg.Root;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;

            try
            {
                child = Process.Start(psi);
                childPid = child.Id;
                Log.Write("started node pid=" + childPid + " exe=" + node + " cwd=" + cfg.Root);
            }
            catch (Exception ex)
            {
                error = "无法启动 node 进程：" + ex.Message;
                return false;
            }

            DrainToLog(child.StandardOutput);
            DrainToLog(child.StandardError);

            DateTime deadline = DateTime.UtcNow.AddSeconds(cfg.StartTimeoutSeconds);
            int ticks = 0;
            while (DateTime.UtcNow < deadline)
            {
                if (child.HasExited)
                {
                    error = string.Format(CultureInfo.InvariantCulture,
                        "服务进程已退出（exit code {0}）。日志：{1}", child.ExitCode, cfg.LogFile);
                    return false;
                }
                string url = ReadRecordedUrl();
                if (url != null && Probe(url, 800))
                {
                    Url = url;
                    Log.Write("server ready at " + url + " (started by us)");
                    return true;
                }
                string direct = string.Format(CultureInfo.InvariantCulture, "http://127.0.0.1:{0}", cfg.Port);
                if (Probe(direct, 600))
                {
                    Url = direct;
                    Log.Write("server ready at " + Url + " (started by us)");
                    return true;
                }
                if (progress != null && ticks % 6 == 0)
                    progress(string.Format(CultureInfo.InvariantCulture,
                        "正在启动本地服务… {0}s（首次运行会生成演示项目数据）", ticks / 2));
                ticks++;
                Thread.Sleep(500);
            }

            error = string.Format(CultureInfo.InvariantCulture,
                "服务在 {0} 秒内没有就绪。日志：{1}", cfg.StartTimeoutSeconds, cfg.LogFile);
            return false;
        }

        static void DrainToLog(StreamReader reader)
        {
            var thread = new Thread(() =>
            {
                try
                {
                    string line;
                    while ((line = reader.ReadLine()) != null)
                        if (line.Length > 0) Log.Write("server: " + line);
                }
                catch (Exception) { }
            });
            thread.IsBackground = true;
            thread.Start();
        }

        /// <summary>Kills the server and its children (git/npm probes) so nothing is orphaned.</summary>
        public void StopOwnedServer()
        {
            if (child == null) return;
            int pid = childPid;
            try
            {
                if (!child.HasExited)
                {
                    Log.Write("stopping node pid=" + pid);
                    KillTree(pid);
                }
            }
            catch (Exception ex) { Log.Write("stop owned: " + ex.Message); }
            finally
            {
                child.Dispose();
                child = null;
                childPid = -1;
            }
        }

        /// <summary>
        /// Explicit "停止服务": also reaps a server that was started outside this launcher
        /// (e.g. by 启动.bat), matched strictly on `src/server/cli.js` in the command line.
        /// </summary>
        public int StopForeignServers()
        {
            int killed = 0;
            try
            {
                using (var searcher = new ManagementObjectSearcher(
                    "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='node.exe'"))
                using (var found = searcher.Get())
                {
                    foreach (ManagementObject row in found)
                    {
                        string commandLine = null;
                        int pid = -1;
                        try
                        {
                            commandLine = Convert.ToString(row["CommandLine"], CultureInfo.InvariantCulture);
                            pid = Convert.ToInt32(row["ProcessId"], CultureInfo.InvariantCulture);
                        }
                        catch (Exception) { }
                        finally { row.Dispose(); }

                        if (pid <= 0 || pid == childPid || string.IsNullOrEmpty(commandLine)) continue;
                        if (commandLine.IndexOf("src" + Path.DirectorySeparatorChar + "server" + Path.DirectorySeparatorChar + "cli.js",
                                StringComparison.OrdinalIgnoreCase) < 0 &&
                            commandLine.IndexOf("src/server/cli.js", StringComparison.OrdinalIgnoreCase) < 0)
                            continue;

                        Log.Write("stopping foreign node pid=" + pid);
                        KillTree(pid);
                        killed++;
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Write("wmi lookup failed: " + ex.Message);
            }
            return killed;
        }

        public static void KillTree(int pid)
        {
            try
            {
                var psi = new ProcessStartInfo("taskkill.exe",
                    string.Format(CultureInfo.InvariantCulture, "/T /F /PID {0}", pid));
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                using (var proc = Process.Start(psi))
                    proc.WaitForExit(8000);
            }
            catch (Exception ex)
            {
                Log.Write("taskkill failed for " + pid + ": " + ex.Message);
                try
                {
                    using (var proc = Process.GetProcessById(pid))
                        if (!proc.HasExited) proc.Kill();
                }
                catch (Exception) { }
            }
        }
    }

    /// <summary>Finds / focuses the Edge app window and launches it when it is missing.</summary>
    static class EdgeWindow
    {
        public const string AppTitle = "AI Project Commander";

        public static IntPtr Find()
        {
            var hits = new List<IntPtr>();
            try
            {
                Native.EnumWindows((hWnd, lParam) =>
                {
                    if (!Native.IsWindowVisible(hWnd)) return true;
                    string title = Native.TextOf(hWnd);
                    if (title.IndexOf(AppTitle, StringComparison.OrdinalIgnoreCase) < 0) return true;
                    // Explorer windows over the project folder share the title - the Chromium
                    // window class is what actually identifies the app window.
                    if (Native.ClassOf(hWnd).IndexOf("Chrome_WidgetWin", StringComparison.Ordinal) < 0) return true;
                    hits.Add(hWnd);
                    return true;
                }, IntPtr.Zero);
            }
            catch (Exception ex)
            {
                Log.Write("enum windows failed: " + ex.Message);
            }
            return hits.Count > 0 ? hits[0] : IntPtr.Zero;
        }

        public static bool Focus(IntPtr hWnd)
        {
            if (hWnd == IntPtr.Zero) return false;
            try
            {
                if (Native.IsIconic(hWnd)) Native.ShowWindow(hWnd, Native.SwRestore);
                return Native.SetForegroundWindow(hWnd);
            }
            catch (Exception ex)
            {
                Log.Write("focus failed: " + ex.Message);
                return false;
            }
        }

        /// <summary>
        /// A dedicated --user-data-dir keeps this a standalone window with its own taskbar
        /// identity and no browser chrome, and stops Edge from folding us into the user's
        /// normal browsing session. (--classid was tested and is ignored by Edge 154, so it
        /// is not passed.)
        /// </summary>
        public static Process Open(string url, string profileDir)
        {
            string exe = ToolPaths.FindEdge();
            if (exe == null)
                throw new InvalidOperationException("未检测到 Microsoft Edge（msedge.exe）。");
            Directory.CreateDirectory(profileDir);
            var args = new StringBuilder();
            args.Append("--app=").Append(url);
            args.Append(" --user-data-dir=\"").Append(profileDir).Append('"');
            args.Append(" --no-first-run --no-default-browser-check --disable-sync");
            args.Append(" --window-size=1440,900 --window-position=60,50");

            var psi = new ProcessStartInfo(exe, args.ToString());
            psi.UseShellExecute = false;
            psi.WorkingDirectory = Path.GetDirectoryName(exe);
            Log.Write("launching edge: " + psi.FileName + " " + psi.Arguments);
            return Process.Start(psi);
        }

        /// <summary>
        /// Closes only the app windows owned by an Edge process that was started with OUR
        /// dedicated --user-data-dir, so a normal Edge tab that happens to show the same
        /// title is never touched. Best-effort: failures just leave the window open.
        /// </summary>
        public static int CloseAppWindows(string profileDir)
        {
            int closed = 0;
            try
            {
                List<uint> pids = ProfileProcessIds(profileDir);
                if (pids.Count == 0) return 0;

                var hits = new List<IntPtr>();
                Native.EnumWindows((hWnd, lParam) =>
                {
                    if (!Native.IsWindowVisible(hWnd)) return true;
                    if (Native.TextOf(hWnd).IndexOf(AppTitle, StringComparison.OrdinalIgnoreCase) < 0) return true;
                    if (Native.ClassOf(hWnd).IndexOf("Chrome_WidgetWin", StringComparison.Ordinal) < 0) return true;
                    uint pid;
                    Native.GetWindowThreadProcessId(hWnd, out pid);
                    if (pids.IndexOf(pid) < 0) return true;
                    hits.Add(hWnd);
                    return true;
                }, IntPtr.Zero);

                foreach (IntPtr hWnd in hits)
                {
                    Native.PostMessage(hWnd, Native.WmClose, IntPtr.Zero, IntPtr.Zero);
                    closed++;
                }
            }
            catch (Exception ex)
            {
                Log.Write("close app windows: " + ex.Message);
            }
            return closed;
        }

        static List<uint> ProfileProcessIds(string profileDir)
        {
            var pids = new List<uint>();
            if (string.IsNullOrEmpty(profileDir)) return pids;
            string longNeedle = profileDir.TrimEnd(Path.DirectorySeparatorChar);
            string shortNeedle = ShortPath(longNeedle);
            try
            {
                using (var searcher = new ManagementObjectSearcher(
                    "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='msedge.exe'"))
                using (var found = searcher.Get())
                {
                    foreach (ManagementObject row in found)
                    {
                        string commandLine = null;
                        uint pid = 0;
                        try
                        {
                            commandLine = Convert.ToString(row["CommandLine"], CultureInfo.InvariantCulture);
                            pid = Convert.ToUInt32(row["ProcessId"], CultureInfo.InvariantCulture);
                        }
                        catch (Exception) { }
                        finally { row.Dispose(); }

                        if (pid == 0 || string.IsNullOrEmpty(commandLine)) continue;
                        bool match = commandLine.IndexOf(longNeedle, StringComparison.OrdinalIgnoreCase) >= 0 ||
                                     (shortNeedle != null &&
                                      commandLine.IndexOf(shortNeedle, StringComparison.OrdinalIgnoreCase) >= 0);
                        if (match) pids.Add(pid);
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Write("edge process lookup failed: " + ex.Message);
            }
            return pids;
        }

        /// <summary>Edge may echo back the 8.3 form of the profile path, so match both.</summary>
        static string ShortPath(string path)
        {
            try
            {
                var buffer = new StringBuilder(260);
                uint length = Native.GetShortPathName(path, buffer, (uint)buffer.Capacity);
                if (length > 0 && length < (uint)buffer.Capacity) return buffer.ToString();
            }
            catch (Exception) { }
            return null;
        }
    }

    /// <summary>Small progress window shown while the local server warms up.</summary>
    sealed class SplashForm : Form
    {
        readonly Label detail;

        public SplashForm(Icon icon)
        {
            SuspendLayout();

            Text = "AI Project Commander";
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(430, 150);
            BackColor = Color.White;
            Font = new Font("Segoe UI", 9f, FontStyle.Regular);

            if (icon != null)
            {
                Icon = icon;
                var picture = new PictureBox();
                picture.Image = icon.ToBitmap();
                picture.SizeMode = PictureBoxSizeMode.Zoom;
                picture.SetBounds(20, 24, 72, 72);
                Controls.Add(picture);
            }

            var headline = new Label();
            headline.Text = "AI Project Commander";
            headline.Font = new Font("Segoe UI Semibold", 12f, FontStyle.Bold);
            headline.SetBounds(106, 26, 312, 24);
            Controls.Add(headline);

            detail = new Label();
            detail.Text = "正在准备…";
            detail.SetBounds(106, 56, 312, 48);
            Controls.Add(detail);

            var bar = new ProgressBar();
            bar.Style = ProgressBarStyle.Marquee;
            bar.MarqueeAnimationSpeed = 25;
            bar.SetBounds(20, 116, 390, 10);
            Controls.Add(bar);

            ResumeLayout(false);
        }

        public void SetStatus(string text)
        {
            if (IsDisposed || string.IsNullOrEmpty(text)) return;
            if (text != detail.Text) detail.Text = text;
        }
    }

    /// <summary>Tray-hosted application context: startup worker + UI pump.</summary>
    sealed class LauncherContext : ApplicationContext
    {
        const int PhaseBooting = 0;
        const int PhaseOpenWindow = 1;
        const int PhaseAwaitWindow = 2;
        const int PhaseReady = 3;
        const int PhaseFailed = 4;

        readonly LauncherConfig cfg;
        readonly ServerController server;
        readonly Icon appIcon;

        NotifyIcon tray;
        ContextMenuStrip menu;
        ToolStripMenuItem statusItem;
        ToolStripMenuItem stopItem;
        SplashForm splash;
        ChromeForm appForm;
        System.Windows.Forms.Timer pump;
        EventWaitHandle showSignal;
        EventWaitHandle exitSignal;
        RegisteredWaitHandle showRegistration;
        RegisteredWaitHandle exitRegistration;

        volatile int phase = PhaseBooting;
        volatile string statusText = "正在检查本地服务…";
        volatile string failure;
        volatile bool showRequested;
        volatile bool exitRequested;
        volatile bool workerBusy;
        int awaitTicks;
        bool exiting;

        public LauncherContext()
        {
            cfg = LauncherConfig.Load();
            Log.Init(cfg.LogFile);
            cfg.EnsureDirectories();
            Log.Write("launcher started, root=" + cfg.Root);

            appIcon = LoadAppIcon();
            server = new ServerController(cfg);

            BuildTray();
            splash = new SplashForm(appIcon);
            splash.SetStatus(statusText);

            bool createdNew;
            try
            {
                showSignal = new EventWaitHandle(false, EventResetMode.AutoReset, Program.ShowEventName, out createdNew);
                showRegistration = ThreadPool.RegisterWaitForSingleObject(showSignal, OnShowSignaled, null, -1, false);
                bool exitCreatedNew;
                exitSignal = new EventWaitHandle(false, EventResetMode.AutoReset, Program.ExitEventName, out exitCreatedNew);
                exitRegistration = ThreadPool.RegisterWaitForSingleObject(exitSignal, OnExitSignaled, null, -1, false);
                Log.Write("cross-instance signals ready (show new=" + createdNew + ", exit new=" + exitCreatedNew + ")");
            }
            catch (Exception ex)
            {
                Log.Write("second-instance signal unavailable: " + ex.Message);
            }

            pump = new System.Windows.Forms.Timer();
            pump.Interval = 250;
            pump.Tick += OnPump;
            pump.Start();

            ThreadPool.QueueUserWorkItem(StartupWorker);
            splash.Show();
        }

        static Icon LoadAppIcon()
        {
            try
            {
                Assembly asm = Assembly.GetExecutingAssembly();
                foreach (string name in asm.GetManifestResourceNames())
                {
                    if (name.IndexOf("app.ico", StringComparison.OrdinalIgnoreCase) < 0) continue;
                    using (Stream stream = asm.GetManifestResourceStream(name))
                    {
                        if (stream == null) continue;
                        try { return new Icon(stream, 32, 32); }
                        catch (Exception) { }
                        stream.Position = 0;
                        return new Icon(stream);
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Write("icon resource unavailable: " + ex.Message);
            }
            return SystemIcons.Application;
        }

        void BuildTray()
        {
            menu = new ContextMenuStrip();
            statusItem = new ToolStripMenuItem("正在启动…");
            statusItem.Enabled = false;

            var openItem = new ToolStripMenuItem("打开窗口");
            openItem.Click += delegate { RequestOpen(); };

            stopItem = new ToolStripMenuItem("停止服务");
            stopItem.Click += delegate { StopService(); };

            var exitItem = new ToolStripMenuItem("退出");
            exitItem.Click += delegate { ExitApp(true); };

            menu.Items.Add(statusItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(openItem);
            menu.Items.Add(stopItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(exitItem);

            tray = new NotifyIcon();
            tray.Icon = appIcon;
            tray.Text = "AI Project Commander";
            tray.ContextMenuStrip = menu;
            tray.Visible = true;
            tray.DoubleClick += delegate { RequestOpen(); };
        }

        void OnShowSignaled(object state, bool timedOut)
        {
            showRequested = true;   // handled on the UI thread by the pump
        }

        void OnExitSignaled(object state, bool timedOut)
        {
            exitRequested = true;
        }

        // ---- background: make sure a server exists -------------------------------------
        void StartupWorker(object state)
        {
            if (workerBusy) return;
            workerBusy = true;
            try
            {
                statusText = "正在检查本地服务…";
                string existing = server.FindExistingUrl();
                if (existing != null)
                {
                    server.Url = existing;
                    Log.Write("adopting already running server at " + existing);
                }
                else
                {
                    string error;
                    if (!server.Start(ReportProgress, out error))
                    {
                        failure = error;
                        phase = PhaseFailed;
                        return;
                    }
                }
                statusText = "正在打开应用窗口…";
                phase = PhaseOpenWindow;
            }
            catch (Exception ex)
            {
                Log.Write("startup worker crashed: " + ex);
                failure = ex.Message;
                phase = PhaseFailed;
            }
            finally
            {
                workerBusy = false;
            }
        }

        void ReportProgress(string text)
        {
            statusText = text;
        }

        // ---- UI pump --------------------------------------------------------------------
        void OnPump(object sender, EventArgs e)
        {
            if (exitRequested)
            {
                exitRequested = false;
                ExitApp(true);       // graceful: kills the node child we own
                return;
            }
            if (showRequested)
            {
                showRequested = false;
                RequestOpen();
            }

            switch (phase)
            {
                case PhaseBooting:
                    SetSplash(statusText);
                    break;

                case PhaseOpenWindow:
                    phase = PhaseAwaitWindow;
                    awaitTicks = 0;
                    OpenOrFocus();
                    SetSplash("正在打开应用窗口…");
                    break;

                case PhaseAwaitWindow:
                    awaitTicks++;
                    IntPtr hWnd = EdgeWindow.Find();
                    if (hWnd != IntPtr.Zero || awaitTicks > 80)
                    {
                        if (hWnd != IntPtr.Zero) EdgeWindow.Focus(hWnd);
                        phase = PhaseReady;
                        CloseSplash();
                        UpdateMenu();
                    }
                    else
                    {
                        SetSplash(statusText);
                    }
                    break;

                case PhaseReady:
                    break;

                case PhaseFailed:
                    phase = PhaseBooting;
                    CloseSplash();
                    string message = failure;
                    failure = null;
                    ShowError(message);
                    break;
            }
        }

        void SetSplash(string text)
        {
            if (splash != null && !splash.IsDisposed) splash.SetStatus(text);
        }

        void CloseSplash()
        {
            if (splash == null || splash.IsDisposed) return;
            splash.Close();
            splash.Dispose();
            splash = null;
        }

        void UpdateMenu()
        {
            if (statusItem == null) return;
            bool up = server.Url != null && ServerController.Probe(server.Url, 700);
            if (up)
            {
                statusItem.Text = "运行中  " + server.Url;
                SetTrayText("AI Project Commander · " + server.Url);
                if (stopItem != null) stopItem.Enabled = true;
            }
            else
            {
                statusItem.Text = "服务已停止";
                SetTrayText("AI Project Commander · 服务已停止");
                if (stopItem != null) stopItem.Enabled = false;
            }
        }

        /// <summary>NotifyIcon.Text throws past 63 characters on .NET 4.5+, so clamp it.</summary>
        void SetTrayText(string text)
        {
            if (tray == null || string.IsNullOrEmpty(text)) return;
            tray.Text = text.Length > 63 ? text.Substring(0, 63) : text;
        }

        void OpenOrFocus()
        {
            // 自绘标题栏窗口（WebView2 壳）：优先走它，最小化时恢复而不是开新窗。
            if (appForm != null && !appForm.IsDisposed)
            {
                appForm.ShowAndFocus();
                return;
            }
            try
            {
                if (string.IsNullOrEmpty(server.Url)) server.Url = server.FindExistingUrl();
                if (string.IsNullOrEmpty(server.Url))
                {
                    failure = "本地服务尚未就绪，无法打开窗口。";
                    phase = PhaseFailed;
                    return;
                }
                appForm = new ChromeForm("AI Project Commander", appIcon);
                appForm.Size = new Size(1440, 900);
                appForm.MinimumSize = new Size(900, 600);
                appForm.StartPosition = FormStartPosition.CenterScreen;
                appForm.FormClosed += delegate { if (appForm != null && appForm.IsDisposed) appForm = null; };
                appForm.AttachWebView(server.Url, cfg.BrowserProfileDir);
                appForm.Show();
            }
            catch (Exception ex)
            {
                // WebView2 不可用时退回 Edge --app 窗口（保留原降级路径）。
                Log.Write("webview2 shell failed, falling back to edge: " + ex);
                try
                {
                    IntPtr hWnd = EdgeWindow.Find();
                    if (hWnd != IntPtr.Zero)
                    {
                        EdgeWindow.Focus(hWnd);
                        return;
                    }
                    using (Process proc = EdgeWindow.Open(server.Url, cfg.BrowserProfileDir))
                    {
                        if (proc != null) proc.Dispose();
                    }
                }
                catch (Exception ex2)
                {
                    Log.Write("open window failed: " + ex2);
                    failure = "无法打开应用窗口：" + ex2.Message;
                    phase = PhaseFailed;
                }
            }
        }

        void RequestOpen()
        {
            if (server.IsUp())
            {
                UpdateMenu();
                OpenOrFocus();
                return;
            }
            if (splash == null || splash.IsDisposed) splash = new SplashForm(appIcon);
            SetSplash("正在启动本地服务…");
            splash.Show();
            phase = PhaseBooting;
            ThreadPool.QueueUserWorkItem(StartupWorker);
        }

        void StopService()
        {
            try
            {
                server.StopOwnedServer();
                int reaped = server.StopForeignServers();
                if (reaped > 0)
                    MessageBox.Show("已停止 " + reaped + " 个由其它方式启动的服务进程。",
                        "AI Project Commander", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                Log.Write("stop service failed: " + ex);
            }
            ExitApp(false);
        }

        void ShowError(string message)
        {
            MessageBox.Show(
                (message ?? "未知错误") + Environment.NewLine + Environment.NewLine +
                "日志：" + cfg.LogFile,
                "AI Project Commander - 启动失败",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            ExitApp(true);
        }

        void ExitApp(bool stopServer)
        {
            if (exiting) return;
            exiting = true;
            Log.Write("exiting (stopServer=" + stopServer + ")");
            try { if (stopServer) server.StopOwnedServer(); }
            catch (Exception ex) { Log.Write("stop on exit: " + ex.Message); }
            try
            {
                if (showRegistration != null) showRegistration.Unregister(null);
                if (exitRegistration != null) exitRegistration.Unregister(null);
                if (showSignal != null) showSignal.Dispose();
                if (exitSignal != null) exitSignal.Dispose();
            }
            catch (Exception) { }
            CloseSplash();
            try
            {
                int closed = EdgeWindow.CloseAppWindows(cfg.BrowserProfileDir);
                Log.Write("closed " + closed + " app window(s)");
            }
            catch (Exception ex) { Log.Write("closing windows: " + ex.Message); }
            if (tray != null)
            {
                tray.Visible = false;
                tray.Dispose();
                tray = null;
            }
            if (menu != null) menu.Dispose();
            Application.ExitThread();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && !exiting) ExitApp(true);
            base.Dispose(disposing);
        }
    }

    static class Program
    {
        public const string Aumid = "Ztt.AIProjectCommander";
        public const string ShowEventName = "Ztt.AIProjectCommander.ShowRequested";
        public const string ExitEventName = "Ztt.AIProjectCommander.ExitRequested";
        const string MutexName = "Ztt.AIProjectCommander.SingleInstance";

        static Mutex singleInstanceMutex;

        [STAThread]
        static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            try
            {
                Native.SetCurrentProcessExplicitAppUserModelID(Aumid);
            }
            catch (Exception) { }

            bool createdNew = true;
            try
            {
                singleInstanceMutex = new Mutex(true, MutexName, out createdNew);
            }
            catch (Exception ex)
            {
                Log.Write("mutex unavailable: " + ex.Message);
                createdNew = true;
            }

            if (!createdNew)
            {
                // Second launch: never start a second server. Either ask the resident
                // instance to shut down (--exit) or to show its window (default).
                bool wantsExit = HasSwitch(args, "--exit");
                if (!wantsExit || !SignalEvent(ExitEventName))
                {
                    if (wantsExit) Log.Write("--exit: no resident instance to stop");
                    else AskRunningInstanceToShowWindow();
                }
                GC.KeepAlive(singleInstanceMutex);
                return 0;
            }

            if (HasSwitch(args, "--exit"))
            {
                GC.KeepAlive(singleInstanceMutex);
                return 0;
            }

            Application.ThreadException += delegate(object s, ThreadExceptionEventArgs e)
            {
                Log.Write("UI thread exception: " + e.Exception);
            };
            AppDomain.CurrentDomain.UnhandledException += delegate(object s, UnhandledExceptionEventArgs e)
            {
                Log.Write("unhandled: " + e.ExceptionObject);
            };

            try
            {
                Application.Run(new LauncherContext());
            }
            catch (Exception ex)
            {
                Log.Write("fatal: " + ex);
                MessageBox.Show(ex.Message, "AI Project Commander", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            GC.KeepAlive(singleInstanceMutex);
            return 0;
        }

        static bool HasSwitch(string[] args, string switchName)
        {
            if (args == null) return false;
            foreach (string a in args)
                if (string.Equals(a, switchName, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        /// <summary>Nudges a resident instance through its named wait handle. False if none is listening.</summary>
        static bool SignalEvent(string eventName)
        {
            EventWaitHandle handle;
            try
            {
                if (EventWaitHandle.TryOpenExisting(eventName, out handle))
                {
                    using (handle) return handle.Set();
                }
            }
            catch (Exception ex)
            {
                Log.Write("could not signal " + eventName + ": " + ex.Message);
            }
            return false;
        }

        /// <summary>Second double-click: tell the resident instance to show its window.</summary>
        static void AskRunningInstanceToShowWindow()
        {
            if (SignalEvent(ShowEventName)) return;

            // No wait handle to poke: still better than doing nothing.
            try
            {
                IntPtr hWnd = EdgeWindow.Find();
                if (hWnd != IntPtr.Zero)
                {
                    EdgeWindow.Focus(hWnd);
                    return;
                }
                LauncherConfig cfg = LauncherConfig.Load();
                string url = null;
                try
                {
                    if (File.Exists(cfg.UrlFile)) url = File.ReadAllText(cfg.UrlFile, Encoding.UTF8).Trim();
                }
                catch (Exception) { }
                if (string.IsNullOrEmpty(url)) url = "http://127.0.0.1:" + cfg.Port.ToString(CultureInfo.InvariantCulture);
                EdgeWindow.Open(url, cfg.BrowserProfileDir);
            }
            catch (Exception ex)
            {
                Log.Write("fallback reopen failed: " + ex.Message);
            }
        }
    }
}
