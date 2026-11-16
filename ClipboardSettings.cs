using System;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Threading;
using System.Web.Script.Serialization;

namespace Xinyu.PhoneNotifications
{
    internal sealed partial class Controller
    {
        private readonly SemaphoreSlim clipboardImageReads = new SemaphoreSlim(2);
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
        private async Task PublishClipboardImageAsync(string id, int index, bool large)
        {
            await clipboardImageReads.WaitAsync();
            try {
                string data = await Task.Run(delegate { return ReadClipboardImage(id,index,large); });
                PostDesktopMessage(new { type="clipboard-image", id=id, index=index, large=large, data=data });
            } catch { PostDesktopMessage(new { type="clipboard-image", id=id, index=index, large=large, error="图片已删除或暂时无法预览" }); }
            finally { clipboardImageReads.Release(); }
        }
        private string ReadClipboardImage(string id, int index, bool large)
        {
            if (!System.Text.RegularExpressions.Regex.IsMatch(id,"\\A[a-f0-9]{32}\\z") || index < 0 || index >= 20) throw new InvalidOperationException();
            var serializer = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };
            var history = serializer.DeserializeObject(File.ReadAllText(Path.Combine(dataRoot,"clipboard-receipts.json"),Encoding.UTF8)) as object[];
            Dictionary<string,object> receipt = null;
            if (history != null) foreach (object value in history) {
                var item = value as Dictionary<string,object>;
                if (item != null && Convert.ToString(item["id"]) == id && Convert.ToString(item["kind"]) != "text") { receipt = item; break; }
            }
            if (receipt == null) throw new InvalidOperationException();
            var files = receipt["files"] as object[];
            if (files == null || index >= files.Length) throw new InvalidOperationException();
            string name = Convert.ToString(files[index]);
            if (String.IsNullOrEmpty(name) || Path.GetFileName(name) != name || name.IndexOf(':') >= 0) throw new InvalidOperationException();
            string directory = Path.Combine(dataRoot,"inbox",id), filename = Path.Combine(directory,name);
            if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0 || (File.GetAttributes(filename) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException();
            long size = new FileInfo(filename).Length;
            if (size <= 0 || size > 50L * 1024 * 1024) throw new InvalidOperationException();
            using (var stream = File.OpenRead(filename))
            using (var source = Image.FromStream(stream,true,true)) {
                if (source.RawFormat.Guid != ImageFormat.Png.Guid && source.RawFormat.Guid != ImageFormat.Jpeg.Guid) throw new InvalidOperationException();
                if (source.Width > 16384 || source.Height > 16384 || (long)source.Width * source.Height > 40000000) throw new InvalidOperationException();
                int maxWidth = large ? 1280 : 224, maxHeight = large ? 960 : 168;
                double scale = Math.Min(1,Math.Min((double)maxWidth/source.Width,(double)maxHeight/source.Height));
                using (var bitmap = new Bitmap(Math.Max(1,(int)(source.Width*scale)),Math.Max(1,(int)(source.Height*scale)),PixelFormat.Format32bppPArgb))
                using (var graphics = Graphics.FromImage(bitmap))
                using (var output = new MemoryStream()) {
                    graphics.Clear(Color.Transparent); graphics.CompositingMode = CompositingMode.SourceCopy;
                    graphics.InterpolationMode = InterpolationMode.HighQualityBicubic; graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    graphics.DrawImage(source,0,0,bitmap.Width,bitmap.Height); bitmap.Save(output,ImageFormat.Png);
                    return "data:image/png;base64,"+Convert.ToBase64String(output.ToArray());
                }
            }
        }
    }
}
