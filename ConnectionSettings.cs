using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Xinyu.PhoneNotifications
{
    internal sealed partial class Controller
    {
        private async Task SaveNetworkAsync(string address, int port)
        {
            IPAddress parsed;
            if (!IPAddress.TryParse(address, out parsed) || parsed.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork || parsed.Equals(IPAddress.Any)
                || (!IPAddress.IsLoopback(parsed) && !AppEnvironment.Networks().Cast<Dictionary<string, object>>().Any(item => Convert.ToString(item["address"]) == address)))
                throw new InvalidOperationException("请选择当前电脑的 IPv4 地址，或点击刷新网络列表");
            if (port < 1024 || port > 65535) throw new InvalidOperationException("端口须在 1024–65535 之间");
            busy = true;
            PublishDesktopState();
            string filename = Path.Combine(dataRoot, "config.json");
            var old = ReadJson(filename);
            string oldOrigin = receiverOrigin;
            try {
                await StopReceiver();
                var probe = new System.Net.Sockets.TcpListener(parsed, port);
                try { probe.Start(); } finally { probe.Stop(); }
                var next = new Dictionary<string, object>(old);
                next["host"] = address; next["port"] = port;
                AppEnvironment.Save(filename, next);
                receiverOrigin = "http://" + address + ":" + port;
                if (enabled || clipboardEnabled) StartReceiver();
                desktopReceiver = ReadSavedNotificationHistory();
                Feedback("电脑地址已保存。请复制新的 Scriptable 脚本更新手机；端口变化后需重新配置防火墙");
            } catch {
                AppEnvironment.Save(filename, old); receiverOrigin = oldOrigin;
                if (enabled || clipboardEnabled) StartReceiver();
                throw;
            } finally { busy = false; RefreshStatus(); }
        }

        private async Task ConfigureFirewallAsync()
        {
            busy = true; PublishDesktopState();
            try {
                string shell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
                string arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + Path.Combine(root, "configure-firewall.ps1") + "\" -NodePath \"" + nodePath + "\" -Port " + new Uri(receiverOrigin).Port;
                using (var process = Process.Start(new ProcessStartInfo(shell, arguments) { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden })) {
                    await Task.Run(delegate { process.WaitForExit(); });
                    if (process.ExitCode != 0) throw new InvalidOperationException("防火墙配置失败，请检查管理员授权或系统防火墙策略");
                }
                Feedback("已允许当前接收程序在公用和专用网络中接受本地子网访问，无需修改网络类型");
            } finally { busy = false; PublishDesktopState(); }
        }
    }
}
