using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Xinyu.PhoneNotifications
{
    internal sealed partial class Controller
    {
        private const string DesktopUrl = "https://phone-notify.local/desktop.html";
        private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string RunName = "IPhoneLanNotify";
        private WebView2 webView;
        private Label loadingLabel;
        private bool webReady;
        private bool webInitializing;
        private bool desktopPolling;
        private bool desktopInspecting;
        private bool receivingRunning;
        private bool receivingReady;
        private string webError = "";
        private string desktopTab = "notifications";
        private Dictionary<string, object> desktopReceiver;

        private void PrepareDesktopView()
        {
            webView = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = System.Drawing.Color.FromArgb(245,247,251) };
            loadingLabel = new Label { Text = "正在加载本地设置…", Dock = DockStyle.Fill, TextAlign = System.Drawing.ContentAlignment.MiddleCenter };
            form.Controls.Add(webView);
            form.Controls.Add(loadingLabel);
        }

        private async void EnsureDesktopStarted()
        {
            if (webReady || webInitializing) return;
            webInitializing = true;
            try
            {
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataRoot, ".webview2-profile"));
                await webView.EnsureCoreWebView2Async(environment);
                webView.CoreWebView2.SetVirtualHostNameToFolderMapping("phone-notify.local", Path.Combine(root, "public"), CoreWebView2HostResourceAccessKind.DenyCors);
                webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
                webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
                webView.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; };
                webView.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) { if (!TrustedPage(e.Uri)) e.Cancel = true; };
                webView.CoreWebView2.WebMessageReceived += DesktopMessageReceived;
                webView.CoreWebView2.NavigationCompleted += async delegate(object sender, CoreWebView2NavigationCompletedEventArgs e) {
                    webReady = e.IsSuccess;
                    loadingLabel.Visible = !webReady;
                    if (!webReady) { webError = e.WebErrorStatus.ToString(); loadingLabel.Text = "设置页加载失败，请重新打开程序"; }
                    else { webError = ""; await PollDesktopStateAsync(); PostDesktopMessage(new { type = "navigate", tab = desktopTab }); }
                    RefreshStatus();
                };
                webView.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
                webView.CoreWebView2.WebResourceRequested += delegate(object sender, CoreWebView2WebResourceRequestedEventArgs e) {
                    Uri uri;
                    if (!Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out uri) || uri.Scheme != "https" || uri.Host != "phone-notify.local")
                        e.Response = environment.CreateWebResourceResponse(null, 403, "Blocked", "Content-Type: text/plain");
                };
                webView.Source = new Uri(DesktopUrl);
            }
            catch (Exception error) { webError = error.Message; loadingLabel.Text = "设置页无法加载：\n" + error.Message + "\n\n请运行发行包中的 check-environment.ps1 检查 WebView2 Runtime"; RefreshStatus(); }
            finally { webInitializing = false; }
        }

        private static bool TrustedPage(string source)
        {
            Uri uri;
            return Uri.TryCreate(source, UriKind.Absolute, out uri) && uri.Scheme == "https" && uri.Host == "phone-notify.local" && uri.AbsolutePath == "/desktop.html";
        }

        private bool StartupEnabled()
        {
            using (var key = Registry.CurrentUser.OpenSubKey(RunKey))
                return key != null && string.Equals(Convert.ToString(key.GetValue(RunName)), StartupCommand(), StringComparison.OrdinalIgnoreCase);
        }

        private string StartupCommand() { return "\"" + Path.Combine(root, "PhoneNotify.exe") + "\" --background"; }

        private void ChangeStartup(bool value)
        {
            using (var key = Registry.CurrentUser.CreateSubKey(RunKey))
            {
                string existing = Convert.ToString(key.GetValue(RunName));
                if (!string.IsNullOrEmpty(existing) && !string.Equals(existing, StartupCommand(), StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("同名启动项已被其他程序占用");
                if (value) key.SetValue(RunName, StartupCommand(), RegistryValueKind.String);
                else key.DeleteValue(RunName, false);
            }
            RefreshStatus();
        }

        private async void DesktopMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            if (!TrustedPage(e.Source)) return;
            try
            {
                var message = json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
                string action = Convert.ToString(message["action"]);
                if (action == "init") { await PollDesktopStateAsync(); PublishDesktopState(); }
                else if (action == "network-save") { if (!busy) await SaveNetworkAsync(Convert.ToString(message["host"]), Convert.ToInt32(message["port"])); }
                else if (action == "network-refresh") { PublishDesktopState(); }
                else if (action == "firewall") { if (!busy) await ConfigureFirewallAsync(); }
                else if (action == "receiving") { if (!busy) await ChangeReceiving(Convert.ToBoolean(message["enabled"])); }
                else if (action == "startup") { if (!busy) ChangeStartup(Convert.ToBoolean(message["enabled"])); }
                else if (action == "copy") {
                    string text = Convert.ToString(message["text"]);
                    if (text.Length > 65536) throw new InvalidOperationException("复制内容过长");
                    Clipboard.SetText(text);
                    Feedback("已复制到剪贴板");
                }
                else if (action == "export-script") {
                    string text = Convert.ToString(message["text"]);
                    if (text.Length > 65536) throw new InvalidOperationException("脚本内容过长");
                    using (var dialog = new SaveFileDialog { FileName = "通知静默转发.js", Filter = "JavaScript 脚本 (*.js)|*.js", AddExtension = true }) {
                        if (dialog.ShowDialog(form) == DialogResult.OK) {
                            File.WriteAllText(dialog.FileName, text, new UTF8Encoding(false));
                            Feedback("脚本已导出，可传到 iPhone 后导入 Scriptable");
                        }
                    }
                }
                else if (action == "test") {
                    if (!receivingReady || busy) { Feedback("请先开启接收并等待服务就绪"); return; }
                    var reply = await ReceiverRequestAsync("test", "POST");
                    Feedback(Convert.ToBoolean(reply["ok"]) ? "测试通知已发送，请查看 Windows 通知" : "测试通知发送失败");
                    await PollDesktopStateAsync();
                }
            }
            catch (Exception error) { Feedback(error.Message); PublishDesktopState(); }
        }

        private Task<Dictionary<string, object>> ReceiverRequestAsync(string endpoint, string method)
        {
            return Task.Run(delegate {
                var request = (HttpWebRequest)WebRequest.Create(receiverOrigin + "/" + endpoint + "/" + accessToken);
                request.Method = method;
                request.Proxy = null;
                request.Timeout = 8000;
                request.ReadWriteTimeout = 8000;
                if (method == "POST") request.ContentLength = 0;
                using (var response = request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                    return new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
            });
        }

        private async Task PollDesktopStateAsync()
        {
            if (!webReady || desktopPolling || !form.Visible) return;
            desktopPolling = true;
            try {
                if (receivingReady && !busy) desktopReceiver = await ReceiverRequestAsync("status", "GET");
                else desktopReceiver = ReadSavedNotificationHistory();
            } catch { desktopReceiver = ReadSavedNotificationHistory(); }
            finally { desktopPolling = false; PublishDesktopState(); }
        }

        private void PublishDesktopState()
        {
            PostDesktopMessage(new {
                type = "state",
                controller = new { receiving = receivingRunning, ready = receivingReady, startupEnabled = StartupEnabled(), busy = busy },
                receiver = desktopReceiver,
                focusNotificationId = selectedNotificationId,
                config = new { notifyUrl = receiverOrigin + "/notify/" + accessToken, host = new Uri(receiverOrigin).Host, port = new Uri(receiverOrigin).Port, networks = AppEnvironment.Networks(), dataDirectory = dataRoot }
            });
        }

        private void PostDesktopMessage(object message)
        {
            if (webReady && webView.CoreWebView2 != null) webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(message));
        }

        private void Feedback(string text) { PostDesktopMessage(new { type = "feedback", text = text }); }

        private async Task InspectDesktopAsync()
        {
            if (desktopInspecting) return;
            desktopInspecting = true;
            string directory = Path.Combine(root, ".verification");
            Directory.CreateDirectory(directory);
            try
            {
                ShowWindow();
                DateTime deadline = DateTime.UtcNow.AddSeconds(20);
                while (!webReady && DateTime.UtcNow < deadline) await Task.Delay(100);
                if (!webReady) throw new InvalidOperationException("Embedded settings did not become ready: " + webError);
                string request = Path.Combine(directory, "request.json");
                string operation = File.Exists(request) ? Convert.ToString(ReadJson(request)["operation"]) : "snapshot";
                if (File.Exists(request)) File.Delete(request);
                if (operation == "startup") await webView.ExecuteScriptAsync("document.getElementById('startup-toggle').click()");
                else if (operation == "receiving") await webView.ExecuteScriptAsync("document.getElementById('receive-toggle').click()");
                else if (operation == "test") await webView.ExecuteScriptAsync("document.getElementById('test').click()");
                else if (operation == "setup") await webView.ExecuteScriptAsync("document.querySelector('[data-tab=setup]').click()");
                else if (operation == "notifications") await webView.ExecuteScriptAsync("document.querySelector('[data-tab=notifications]').click()");
                await Task.Delay(700);
                while (busy && DateTime.UtcNow < deadline) await Task.Delay(100);
                RefreshStatus();
                await PollDesktopStateAsync();
                await Task.Delay(300);
                string result = await webView.ExecuteScriptAsync("JSON.stringify({title:document.title,switches:document.querySelectorAll('[role=switch]').length,receive:document.getElementById('receive-toggle').getAttribute('aria-checked'),startup:document.getElementById('startup-toggle').getAttribute('aria-checked'),configured:!!window.desktopState&&window.desktopState.configured,scriptLength:document.getElementById('scriptable-code').value.length,setupVisible:!document.getElementById('setup').hidden,records:document.querySelectorAll('.notification').length,importShortcutPresent:!!document.getElementById('copy-shortcut'),exportScriptPresent:!!document.getElementById('export-script'),brandIconLoaded:document.querySelector('.app-header img').naturalWidth>0,importQrLoaded:document.querySelector('.import-guide img').naturalWidth>0,horizontalOverflow:document.documentElement.scrollWidth>innerWidth,status:document.getElementById('status').textContent})");
                using (var output = File.Create(Path.Combine(directory, "desktop.png"))) await webView.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, output);
                var inspection = json.Deserialize<Dictionary<string, object>>(json.Deserialize<string>(result));
                string selection = await webView.ExecuteScriptAsync("JSON.stringify({selectedId:document.querySelector('.notification.selected')?.dataset.notificationId||null,selectedVisible:(()=>{const e=document.querySelector('.notification.selected');if(!e)return false;const r=e.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight})(),notificationsVisible:!document.getElementById('notifications').hidden,focusedId:document.activeElement?.dataset.notificationId||null})");
                inspection["selection"] = json.Deserialize<Dictionary<string, object>>(json.Deserialize<string>(selection));
                File.WriteAllText(Path.Combine(directory, "desktop-check.json"), json.Serialize(inspection), new UTF8Encoding(false));
            }
            catch (Exception error) { File.WriteAllText(Path.Combine(directory, "desktop-check.json"), json.Serialize(new { error = error.Message }), new UTF8Encoding(false)); }
            finally { desktopInspecting = false; }
        }

        private void DisposeDesktop() { if (webView != null) webView.Dispose(); }
    }
}
