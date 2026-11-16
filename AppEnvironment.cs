using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace Xinyu.PhoneNotifications
{
    internal static class AppEnvironment
    {
        internal static string DataRoot;
        internal static bool FirstRun;
        internal static string DataDirectory(string root)
        {
            string configured = Environment.GetEnvironmentVariable("PHONE_NOTIFY_DATA_DIR");
            if (!String.IsNullOrWhiteSpace(configured)) {
                if (!Path.IsPathRooted(configured)) throw new InvalidOperationException("PHONE_NOTIFY_DATA_DIR 必须是绝对路径");
                return Path.GetFullPath(configured);
            }
            // Existing portable installations retain their data and pairing address.
            if (File.Exists(Path.Combine(root, "config.json"))) return root;
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PhoneNotify", "data");
        }

        internal static object[] Networks()
        {
            return NetworkInterface.GetAllNetworkInterfaces()
                .Where(adapter => adapter.OperationalStatus == OperationalStatus.Up && adapter.NetworkInterfaceType != NetworkInterfaceType.Loopback && adapter.NetworkInterfaceType != NetworkInterfaceType.Tunnel)
                .OrderByDescending(adapter => adapter.GetIPProperties().GatewayAddresses.Any(gateway => gateway.Address.AddressFamily == AddressFamily.InterNetwork && !gateway.Address.Equals(IPAddress.Any)))
                .SelectMany(adapter => adapter.GetIPProperties().UnicastAddresses.Where(address => address.Address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(address.Address))
                    .Select(address => (object)new Dictionary<string, object> { { "address", address.Address.ToString() }, { "name", adapter.Name }, { "description", adapter.Description } })).ToArray();
        }

        internal static string NewToken()
        {
            byte[] bytes = new byte[24];
            using (var random = RandomNumberGenerator.Create()) random.GetBytes(bytes);
            return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }

        internal static string FindNode(string root, string previous)
        {
            var candidates = new List<string>();
            if (!String.IsNullOrEmpty(previous) && Path.IsPathRooted(previous)) candidates.Add(previous);
            candidates.Add(Path.Combine(root, "runtime", "node.exe"));
            foreach (string directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator)) {
                try { if (!String.IsNullOrWhiteSpace(directory)) candidates.Add(Path.Combine(directory.Trim('"'), "node.exe")); } catch (ArgumentException) { }
            }
            string found = candidates.FirstOrDefault(File.Exists);
            if (found == null) throw new InvalidOperationException("缺少 Node.js。请使用含 runtime\\node.exe 的完整发行包，或安装 Node.js 22/24 并加入 PATH");
            return Path.GetFullPath(found);
        }

        internal static void Save(string filename, object value)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(filename));
            string temporary = filename + "." + Guid.NewGuid().ToString("N") + ".tmp";
            File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(value), new UTF8Encoding(false));
            if (File.Exists(filename)) File.Replace(temporary, filename, null); else File.Move(temporary, filename);
        }

        internal static void Initialize(string root)
        {
            DataRoot = DataDirectory(root);
            Directory.CreateDirectory(DataRoot);
            Environment.SetEnvironmentVariable("PHONE_NOTIFY_DATA_DIR", DataRoot);
            string filename = Path.Combine(DataRoot, "config.json");
            FirstRun = !File.Exists(filename);
            var serializer = new JavaScriptSerializer();
            var config = FirstRun ? new Dictionary<string, object>() : serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(filename, Encoding.UTF8));
            if (FirstRun) {
                var first = Networks().FirstOrDefault() as Dictionary<string, object>;
                config["host"] = first == null ? "127.0.0.1" : first["address"];
                config["port"] = 18766;
                config["token"] = NewToken();
            }
            object previous;
            config["nodePath"] = FindNode(root, config.TryGetValue("nodePath", out previous) ? Convert.ToString(previous) : null);
            IPAddress host;
            if (!IPAddress.TryParse(Convert.ToString(config["host"]), out host) || host.AddressFamily != AddressFamily.InterNetwork || host.Equals(IPAddress.Any)) throw new InvalidOperationException("配置中的 host 必须是本机 IPv4 地址");
            int port = Convert.ToInt32(config["port"]);
            if (port < 1024 || port > 65535 || !System.Text.RegularExpressions.Regex.IsMatch(Convert.ToString(config["token"]), "\\A[A-Za-z0-9_-]{32,100}\\z")) throw new InvalidOperationException("端口或配对令牌无效");
            Save(filename, config);
        }
    }
}
