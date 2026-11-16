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
        private void PublishClipboardText(string id)
        {
            try {
                if (!System.Text.RegularExpressions.Regex.IsMatch(id,"\\A[a-f0-9]{32}\\z")) throw new InvalidOperationException();
                var history = (object[])ReadClipboardState()["history"];
                Dictionary<string,object> receipt = null;
                foreach (object value in history) {
                    var item = value as Dictionary<string,object>;
                    if (item != null && Convert.ToString(item["id"]) == id && Convert.ToString(item["kind"]) == "text") { receipt = item; break; }
                }
                if (receipt == null) throw new InvalidOperationException();
                object truncated;
                string text;
                if (receipt.TryGetValue("textTruncated",out truncated) && Convert.ToBoolean(truncated)) {
                    string filename = Path.Combine(dataRoot,"clipboard-text",id+".txt");
                    if (new FileInfo(filename).Length > 1024 * 1024) throw new InvalidOperationException();
                    text = Encoding.UTF8.GetString(File.ReadAllBytes(filename));
                } else {
                    object saved;
                    if (!receipt.TryGetValue("text",out saved) || !(saved is string)) throw new InvalidOperationException();
                    text = (string)saved;
                }
                PostDesktopMessage(new { type="clipboard-text", id=id, text=text });
            } catch { PostDesktopMessage(new { type="clipboard-text", id=id, error="这条记录没有保存文字内容，或内容已清理" }); }
        }
    }
}
