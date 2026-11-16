using System;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace Xinyu.PhoneNotifications
{
    internal sealed partial class Controller
    {
        private Dictionary<string, object> ReadClipboardState()
        {
            object receipts = new object[0];
            try { receipts = json.DeserializeObject(File.ReadAllText(Path.Combine(dataRoot,"clipboard-receipts.json"),Encoding.UTF8)) as object[] ?? new object[0]; } catch { }
            return new Dictionary<string, object> { { "enabled", clipboardEnabled }, { "history", receipts } };
        }
        private async Task ChangeClipboardAsync(bool value)
        {
            bool previous = clipboardEnabled;
            busy = true; PublishDesktopState();
            try {
                clipboardEnabled = value;
                SavePreference(enabled);
                if (enabled || clipboardEnabled) StartReceiver(); else await StopReceiver();
                Feedback(value ? "已开启接收手机剪贴板，收到后替换电脑当前剪贴板" : "已关闭接收手机剪贴板");
            } catch {
                clipboardEnabled = previous; SavePreference(enabled); throw;
            } finally { busy = false; RefreshStatus(); }
        }
    }
}
