using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Management;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace Xinyu.PhoneNotifications
{
    internal static class Program
    {
        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        private static extern int SetCurrentProcessExplicitAppUserModelID(string appId);

        [STAThread]
        private static void Main(string[] args)
        {
            SetCurrentProcessExplicitAppUserModelID("Xinyu.PhoneNotifications.Control");
            string root = AppDomain.CurrentDomain.BaseDirectory;
            try { AppEnvironment.Initialize(root); }
            catch (Exception error) { MessageBox.Show(error.Message, "手机通知：环境检查失败", MessageBoxButtons.OK, MessageBoxIcon.Error); return; }
            string identity;
            using (var hash = SHA256.Create())
            {
                byte[] bytes = Encoding.UTF8.GetBytes(AppEnvironment.DataRoot.ToLowerInvariant());
                identity = BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").Substring(0, 24);
            }
            string prefix = "Local\\Xinyu.PhoneNotifications." + identity;
            string notificationId = NotificationActivation.ParseArguments(args);
            string activationPipeName = "Xinyu.PhoneNotifications.Activate." + identity;
            bool owner;
            using (var mutex = new Mutex(true, prefix, out owner))
            {
                if (!owner)
                {
                    if (notificationId != null) { NotificationActivation.AllowControllerForeground(root); NotificationActivation.Forward(activationPipeName, notificationId); return; }
                    string action = args.Contains("--exit") ? ".Exit" : args.Contains("--inspect-ui") ? ".Inspect" : args.Contains("--on") ? ".On" : args.Contains("--off") ? ".Off" : !args.Contains("--background") ? ".Open" : null;
                    if (action != null)
                    {
                        for (int attempt = 0; attempt < 10; attempt++)
                        {
                            try { using (var signal = EventWaitHandle.OpenExisting(prefix + action)) signal.Set(); break; }
                            catch (WaitHandleCannotBeOpenedException) { Thread.Sleep(100); }
                        }
                    }
                    return;
                }
                if (args.Contains("--exit")) return;
                using (var open = new EventWaitHandle(false, EventResetMode.AutoReset, prefix + ".Open"))
                using (var exit = new EventWaitHandle(false, EventResetMode.AutoReset, prefix + ".Exit"))
                using (var on = new EventWaitHandle(false, EventResetMode.AutoReset, prefix + ".On"))
                using (var off = new EventWaitHandle(false, EventResetMode.AutoReset, prefix + ".Off"))
                using (var inspect = new EventWaitHandle(false, EventResetMode.AutoReset, prefix + ".Inspect"))
                {
                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);
                    bool? initial = args.Contains("--off") ? false : args.Contains("--on") ? true : (bool?)null;
                    try { using (var controller = new Controller(root, open, exit, on, off, inspect, args.Contains("--background") || args.Contains("--toast-activated"), initial, activationPipeName, notificationId)) Application.Run(controller); }
                    catch (Exception error) { MessageBox.Show("手机通知程序无法启动：\n" + error.Message, "手机通知", MessageBoxButtons.OK, MessageBoxIcon.Error); }
                }
                mutex.ReleaseMutex();
            }
        }
    }

    internal sealed partial class Controller : ApplicationContext
    {
        private readonly string root;
        private readonly string dataRoot;
        private readonly string preferencesPath;
        private readonly string nodePath;
        private readonly string receiverPath;
        private string receiverOrigin;
        private string accessToken;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private readonly EventWaitHandle openSignal;
        private readonly EventWaitHandle exitSignal;
        private readonly EventWaitHandle onSignal;
        private readonly EventWaitHandle offSignal;
        private readonly EventWaitHandle inspectSignal;
        private readonly System.Windows.Forms.Timer timer;
        private readonly Form form;
        private readonly NotifyIcon tray;
        private readonly ToolStripMenuItem toggleMenu;
        private readonly ToolStripMenuItem settingsMenu;
        private readonly Icon onIcon;
        private readonly Icon offIcon;
        private Process receiver;
        private bool enabled;
        private bool busy;
        private bool exiting;
        private bool stopInitially;
        private DateTime nextSearch = DateTime.MinValue;
        private string lastState;

        public Controller(string appRoot, EventWaitHandle open, EventWaitHandle exit, EventWaitHandle on, EventWaitHandle off, EventWaitHandle inspect, bool startHidden, bool? initial, string activationPipeName, string notificationId)
        {
            root = appRoot;
            dataRoot = AppEnvironment.DataRoot;
            openSignal = open;
            exitSignal = exit;
            onSignal = on;
            offSignal = off;
            inspectSignal = inspect;
            preferencesPath = Path.Combine(dataRoot, "preferences.json");
            receiverPath = Path.Combine(root, "receiver.cjs");
            var config = ReadJson(Path.Combine(dataRoot, "config.json"));
            nodePath = Convert.ToString(config["nodePath"]);
            receiverOrigin = "http://" + config["host"] + ":" + config["port"];
            accessToken = Convert.ToString(config["token"]);
            enabled = File.Exists(preferencesPath) && Convert.ToBoolean(ReadJson(preferencesPath)["receiveEnabled"]);
            if (AppEnvironment.FirstRun) desktopTab = "setup";
            if (initial.HasValue) { enabled = initial.Value; SavePreference(enabled); }
            onIcon = new Icon(Path.Combine(root, "assets", "app.ico"), 32, 32);
            offIcon = DimIcon(onIcon);

            form = new Form {
                Text = "手机通知", ClientSize = new Size(Math.Min(1060, Screen.PrimaryScreen.WorkingArea.Width - 80), Math.Min(780, Screen.PrimaryScreen.WorkingArea.Height - 90)), StartPosition = FormStartPosition.CenterScreen,
                MinimumSize = new Size(760, 560), FormBorderStyle = FormBorderStyle.Sizable, MaximizeBox = true, Icon = onIcon,
                Font = new Font("Microsoft YaHei UI", 10), BackColor = Color.White,
                AutoScaleMode = AutoScaleMode.Dpi
            };
            PrepareDesktopView();
            form.FormClosing += delegate(object sender, FormClosingEventArgs e) { if (!exiting && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; form.Hide(); } };

            var menu = new ContextMenuStrip();
            var openMenu = new ToolStripMenuItem("打开控制窗口");
            openMenu.Click += delegate { ShowWindow(); };
            toggleMenu = new ToolStripMenuItem("接收手机通知") { Checked = enabled };
            toggleMenu.Click += async delegate { if (!busy) await ChangeReceiving(!toggleMenu.Checked); };
            settingsMenu = new ToolStripMenuItem("手机配置");
            settingsMenu.Click += delegate { OpenSettings(); };
            var exitMenu = new ToolStripMenuItem("退出手机通知");
            exitMenu.Click += async delegate { await ExitProgram(); };
            menu.Items.AddRange(new ToolStripItem[] { openMenu, new ToolStripSeparator(), toggleMenu, settingsMenu, new ToolStripSeparator(), exitMenu });
            tray = new NotifyIcon { Icon = enabled ? onIcon : offIcon, Text = "手机通知", Visible = true, ContextMenuStrip = menu };
            tray.DoubleClick += delegate { ShowWindow(); };

            receiver = FindReceiver();
            if (enabled) StartReceiver();
            else if (receiver != null) stopInitially = true;
            timer = new System.Windows.Forms.Timer { Interval = 1000 };
            timer.Tick += async delegate {
                if (exitSignal.WaitOne(0)) { await ExitProgram(); return; }
                if (openSignal.WaitOne(0)) ShowWindow();
                if (!busy && inspectSignal.WaitOne(0)) { await InspectDesktopAsync(); return; }
                if (!busy && offSignal.WaitOne(0)) { await ChangeReceiving(false); return; }
                if (!busy && onSignal.WaitOne(0)) { await ChangeReceiving(true); return; }
                if (stopInitially && !busy) { stopInitially = false; await ChangeReceiving(false); return; }
                if (!busy) { RefreshStatus(); await PollDesktopStateAsync(); }
            };
            timer.Start();
            RefreshStatus();
            StartNotificationActivation(activationPipeName, notificationId);
            if (!startHidden) ShowWindow();
        }

        private Dictionary<string, object> ReadJson(string file)
        {
            return json.Deserialize<Dictionary<string, object>>(File.ReadAllText(file, Encoding.UTF8));
        }

        private void SavePreference(bool value)
        {
            string temporary = preferencesPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
            File.WriteAllText(temporary, json.Serialize(new { receiveEnabled = value }), new UTF8Encoding(false));
            if (File.Exists(preferencesPath)) File.Replace(temporary, preferencesPath, null);
            else File.Move(temporary, preferencesPath);
        }

        private Process FindReceiver()
        {
            string pattern = "(?:^|\\s)\"?" + Regex.Escape(receiverPath) + "\"?(?:\\s|$)";
            using (var query = new ManagementObjectSearcher("SELECT ProcessId,ExecutablePath,CommandLine FROM Win32_Process WHERE Name='node.exe'"))
            using (var matches = query.Get())
            {
                foreach (ManagementObject process in matches)
                {
                    if (!string.Equals(Convert.ToString(process["ExecutablePath"]), nodePath, StringComparison.OrdinalIgnoreCase)) continue;
                    if (!Regex.IsMatch(Convert.ToString(process["CommandLine"]), pattern, RegexOptions.IgnoreCase)) continue;
                    try { return Process.GetProcessById(Convert.ToInt32(process["ProcessId"])); }
                    catch (ArgumentException) { }
                }
            }
            return null;
        }

        private void StartReceiver()
        {
            if (receiver != null && !receiver.HasExited) return;
            receiver = FindReceiver();
            if (receiver != null) return;
            receiver = Process.Start(new ProcessStartInfo(nodePath, "\"" + receiverPath + "\"") {
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden
            });
        }

        private async Task StopReceiver()
        {
            string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
            string args = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + Path.Combine(root, "stop-receiver.ps1") + "\"";
            using (var stop = Process.Start(new ProcessStartInfo(powershell, args) {
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden
            }))
            {
                await Task.Run(delegate { if (!stop.WaitForExit(15000)) throw new TimeoutException("关闭接收程序超时"); });
                if (stop.ExitCode != 0) throw new InvalidOperationException("接收程序未能关闭");
            }
            if (receiver != null) { receiver.Dispose(); receiver = null; }
        }

        private async Task ChangeReceiving(bool value)
        {
            if (busy) return;
            busy = true;
            toggleMenu.Enabled = false;
            PublishDesktopState();
            try
            {
                if (value) StartReceiver();
                else await StopReceiver();
                SavePreference(value);
                enabled = value;
            }
            catch (Exception error) { MessageBox.Show(form, error.Message, "手机通知", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            finally { busy = false; toggleMenu.Enabled = true; RefreshStatus(); }
        }

        private void RefreshStatus()
        {
            if (receiver != null && receiver.HasExited) { receiver.Dispose(); receiver = null; }
            if (receiver == null && DateTime.UtcNow >= nextSearch) { receiver = FindReceiver(); nextSearch = DateTime.UtcNow.AddSeconds(3); }
            bool running = receiver != null;
            bool ready = false;
            if (running)
            {
                try {
                    var runtime = ReadJson(Path.Combine(dataRoot, "runtime.json"));
                    ready = Convert.ToInt32(runtime["pid"]) == receiver.Id && Convert.ToString(runtime["worker"]) == "ready";
                } catch (IOException) { } catch (ArgumentException) { } catch (InvalidOperationException) { }
            }
            toggleMenu.Checked = running;
            receivingRunning = running;
            receivingReady = ready;
            tray.Icon = running ? onIcon : offIcon;
            tray.Text = running ? (ready ? "手机通知：接收已开启" : "手机通知：正在启动") : "手机通知：接收已关闭";
            settingsMenu.Enabled = true;
            PublishDesktopState();
            string snapshot = json.Serialize(new { pid = Process.GetCurrentProcess().Id, receiving = running, preferred = enabled, ready = ready, visible = form.Visible, busy = busy, startupEnabled = StartupEnabled(), webReady = webReady, webError = webError, selectedNotificationId = selectedNotificationId, activationSource = lastActivationSource });
            if (snapshot != lastState)
            {
                string destination = Path.Combine(dataRoot, "controller-state.json");
                string temporary = destination + ".tmp";
                File.WriteAllText(temporary, snapshot, new UTF8Encoding(false));
                if (File.Exists(destination)) File.Replace(temporary, destination, null);
                else File.Move(temporary, destination);
                lastState = snapshot;
            }
        }

        private void OpenSettings()
        {
            desktopTab = "setup";
            ShowWindow();
            PostDesktopMessage(new { type = "navigate", tab = desktopTab });
        }

        private void ShowWindow()
        {
            form.Show();
            if (form.WindowState == FormWindowState.Minimized) form.WindowState = FormWindowState.Normal;
            form.Activate();
            EnsureDesktopStarted();
        }

        private async Task ExitProgram()
        {
            if (busy || exiting) return;
            busy = true;
            try { await StopReceiver(); }
            catch (Exception error) { busy = false; MessageBox.Show(form, error.Message, "手机通知"); return; }
            exiting = true;
            timer.Stop();
            tray.Visible = false;
            form.Close();
            ExitThread();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) { StopNotificationActivation(); timer.Dispose(); tray.Dispose(); DisposeDesktop(); form.Dispose(); onIcon.Dispose(); offIcon.Dispose(); if (receiver != null) receiver.Dispose(); }
            base.Dispose(disposing);
        }

        [DllImport("user32.dll")]
        private static extern bool DestroyIcon(IntPtr icon);

        private static Icon DimIcon(Icon original)
        {
            using (var image = new Bitmap(32, 32))
            using (var graphics = Graphics.FromImage(image))
            using (var source = original.ToBitmap())
            using (var attributes = new System.Drawing.Imaging.ImageAttributes())
            {
                attributes.SetColorMatrix(new System.Drawing.Imaging.ColorMatrix(new float[][] {
                    new float[] {.299f,.299f,.299f,0,0}, new float[] {.587f,.587f,.587f,0,0},
                    new float[] {.114f,.114f,.114f,0,0}, new float[] {0,0,0,.6f,0}, new float[] {0,0,0,0,1}
                }));
                graphics.DrawImage(source, new Rectangle(0,0,32,32),0,0,source.Width,source.Height,GraphicsUnit.Pixel,attributes);
                IntPtr handle = image.GetHicon();
                try { return (Icon)Icon.FromHandle(handle).Clone(); }
                finally { DestroyIcon(handle); }
            }
        }
    }
}
