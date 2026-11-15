using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace Xinyu.PhoneNotifications
{
    internal static class NotificationActivation
    {
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool AllowSetForegroundWindow(int processId);
        internal const string Scheme = "xinyu-phone-notify";
        internal static bool ValidId(string value) { return value != null && Regex.IsMatch(value, "\\A[a-f0-9]{16}\\z"); }

        internal static string ParseArguments(string[] args)
        {
            if (args.Length == 2 && args[0] == "--notification" && ValidId(args[1])) return args[1];
            Uri uri;
            if (args.Length == 2 && args[0] == "--activate" && Uri.TryCreate(args[1], UriKind.Absolute, out uri)
                && uri.Scheme == Scheme && uri.Host == "notification" && uri.Query.Length == 0 && uri.Fragment.Length == 0
                && uri.UserInfo.Length == 0 && uri.IsDefaultPort && ValidId(uri.AbsolutePath.TrimStart('/'))
                && uri.AbsolutePath == "/" + uri.AbsolutePath.TrimStart('/')) return uri.AbsolutePath.Substring(1);
            return null;
        }

        internal static void Forward(string pipeName, string id)
        {
            try
            {
                using (var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.Out))
                {
                    pipe.Connect(4000);
                    using (var writer = new StreamWriter(pipe, new UTF8Encoding(false))) { writer.WriteLine(id); writer.Flush(); }
                }
            }
            catch (IOException) { Environment.ExitCode = 1; }
            catch (TimeoutException) { Environment.ExitCode = 1; }
        }

        internal static void Register(string root)
        {
            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Classes\" + Scheme))
            {
                key.SetValue("", "URL:手机通知");
                key.SetValue("URL Protocol", "");
                using (var icon = key.CreateSubKey("DefaultIcon")) icon.SetValue("", "\"" + Path.Combine(root, "assets", "app-no-bell.ico") + "\",0");
                using (var command = key.CreateSubKey(@"shell\open\command"))
                    command.SetValue("", "\"" + Path.Combine(root, "PhoneNotify.exe") + "\" --activate \"%1\"");
            }
        }

        internal static void AllowControllerForeground(string root)
        {
            try
            {
                var state = new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(AppEnvironment.DataRoot, "controller-state.json"), Encoding.UTF8));
                using (var process = Process.GetProcessById(Convert.ToInt32(state["pid"])))
                    if (String.Equals(process.MainModule.FileName, Path.Combine(root, "PhoneNotify.exe"), StringComparison.OrdinalIgnoreCase)) AllowSetForegroundWindow(process.Id);
            }
            catch (IOException) { }
            catch (ArgumentException) { }
            catch (InvalidOperationException) { }
            catch (System.ComponentModel.Win32Exception) { }
        }
    }

    internal sealed partial class Controller
    {
        private readonly object activationLock = new object();
        private NamedPipeServerStream activationPipe;
        private bool activationStopping;
        private string selectedNotificationId;
        private int toastClassCookie;
        private string lastActivationSource;

        private void StartNotificationActivation(string pipeName, string initialId)
        {
            NotificationActivation.Register(root);
            IntPtr windowHandle = form.Handle;
            Native.ToastSourceRegistration.RegisterServer(root);
            Native.NotificationActivator.OpenNotification = id => form.BeginInvoke(new Action(async delegate { lastActivationSource = "windows-toast"; await OpenNotificationAsync(id); }));
            toastClassCookie = new System.Runtime.InteropServices.RegistrationServices().RegisterTypeForComClients(typeof(Native.NotificationActivator), System.Runtime.InteropServices.RegistrationClassContext.LocalServer, System.Runtime.InteropServices.RegistrationConnectionType.MultipleUse);
            Task.Run(async delegate {
                var security = new PipeSecurity();
                security.SetAccessRuleProtection(true, false);
                security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.FullControl, AccessControlType.Allow));
                while (true)
                {
                    NamedPipeServerStream pipe;
                    lock (activationLock)
                    {
                        if (activationStopping) return;
                        pipe = new NamedPipeServerStream(pipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 1024, 1024, security);
                        activationPipe = pipe;
                    }
                    try
                    {
                        await pipe.WaitForConnectionAsync();
                        using (var reader = new StreamReader(pipe, new UTF8Encoding(false)))
                        {
                            var buffer = new char[18];
                            int count = 0;
                            while (count < buffer.Length)
                            {
                                int read = await reader.ReadAsync(buffer, count, 1);
                                if (read == 0 || buffer[count] == '\n') break;
                                count += read;
                            }
                            string id = new string(buffer, 0, count).TrimEnd('\r');
                            if (NotificationActivation.ValidId(id)) form.BeginInvoke(new Action(async delegate { await OpenNotificationAsync(id); }));
                        }
                    }
                    catch (IOException) { }
                    catch (ObjectDisposedException) { }
                    catch (InvalidOperationException) { }
                    finally { pipe.Dispose(); }
                }
            });
            if (initialId != null) form.BeginInvoke(new Action(async delegate { await OpenNotificationAsync(initialId); }));
        }

        private void StopNotificationActivation()
        {
            Native.NotificationActivator.OpenNotification = null;
            if (toastClassCookie != 0) new System.Runtime.InteropServices.RegistrationServices().UnregisterTypeForComClients(toastClassCookie);
            lock (activationLock) { activationStopping = true; if (activationPipe != null) activationPipe.Dispose(); }
        }

        private async Task OpenNotificationAsync(string id)
        {
            if (!NotificationActivation.ValidId(id) || exiting) return;
            try
            {
                selectedNotificationId = id;
                desktopTab = "notifications";
                ShowWindow();
                DateTime deadline = DateTime.UtcNow.AddSeconds(15);
                while ((!webReady || desktopPolling) && DateTime.UtcNow < deadline) await Task.Delay(100);
                if (!webReady) return;
                RefreshStatus();
                await PollDesktopStateAsync();
                PostDesktopMessage(new { type = "focus-notification", id = id });
            }
            catch (ObjectDisposedException) { }
            catch (InvalidOperationException) { }
        }

        private Dictionary<string, object> ReadSavedNotificationHistory()
        {
            try
            {
                string filename = Path.Combine(dataRoot, ".notification-history.json");
                if (new FileInfo(filename).Length > 8 * 1024 * 1024) return null;
                var serializer = new System.Web.Script.Serialization.JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };
                var saved = serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(filename, Encoding.UTF8));
                object items;
                if (Convert.ToInt32(saved["version"]) != 1 || !saved.TryGetValue("items", out items) || !(items is IEnumerable)) return null;
                var history = ((IEnumerable)items).Cast<object>().OfType<Dictionary<string, object>>().Where(item => {
                    object id, at; DateTime timestamp;
                    return item.TryGetValue("id", out id) && NotificationActivation.ValidId(Convert.ToString(id)) && item.TryGetValue("at", out at)
                        && DateTime.TryParse(Convert.ToString(at), out timestamp) && timestamp.ToUniversalTime() >= DateTime.UtcNow.AddDays(-7);
                }).Take(200).ToArray();
                return new Dictionary<string, object> { { "history", history } };
            }
            catch (IOException) { return null; }
            catch (ArgumentException) { return null; }
            catch (InvalidOperationException) { return null; }
            catch (KeyNotFoundException) { return null; }
        }
    }
}
