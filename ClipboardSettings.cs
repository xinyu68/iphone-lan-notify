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
using System.Diagnostics;

namespace Xinyu.PhoneNotifications
{
    internal sealed partial class Controller
    {
        private readonly SemaphoreSlim clipboardImageReads = new SemaphoreSlim(2);
        private bool clipboardCopying;
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
                string text = ReadStoredClipboardText(id,FindClipboardReceipt(id));
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
        private Dictionary<string,object> FindClipboardReceipt(string id)
        {
            if (!System.Text.RegularExpressions.Regex.IsMatch(id,"\\A[a-f0-9]{32}\\z")) throw new InvalidOperationException("无效的接收记录");
            foreach (object value in (object[])ReadClipboardState()["history"]) {
                var item = value as Dictionary<string,object>;
                if (item != null && Convert.ToString(item["id"]) == id) return item;
            }
            throw new InvalidOperationException("这条接收记录已不存在");
        }
        private string ReadStoredClipboardText(string id, Dictionary<string,object> receipt)
        {
            if (Convert.ToString(receipt["kind"]) != "text") throw new InvalidOperationException("记录不是文字类型");
            object truncated, saved;
            string text;
            if (receipt.TryGetValue("textTruncated",out truncated) && Convert.ToBoolean(truncated)) {
                string directory = Path.Combine(dataRoot,"clipboard-text"), filename = Path.Combine(directory,id+".txt");
                if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0 || (File.GetAttributes(filename) & FileAttributes.ReparsePoint) != 0 || new FileInfo(filename).Length > 1024*1024) throw new InvalidOperationException("文字原文已损坏或不可用");
                text = Encoding.UTF8.GetString(File.ReadAllBytes(filename));
            } else {
                if (!receipt.TryGetValue("text",out saved) || !(saved is string)) throw new InvalidOperationException("旧记录未保存原文，无法复制");
                text = (string)saved;
            }
            if (String.IsNullOrEmpty(text) || text.IndexOf('\0') >= 0 || Encoding.UTF8.GetByteCount(text) > 1024*1024) throw new InvalidOperationException("文字原文无效或过大");
            return text;
        }
        private Dictionary<string,object> CreateClipboardCopyRequest(string id, int index)
        {
            var receipt = FindClipboardReceipt(id);
            if (Convert.ToString(receipt["kind"]) == "text") {
                if (index != -1) throw new InvalidOperationException("无效的文字复制参数");
                return new Dictionary<string,object> { {"kind","text"}, {"text",ReadStoredClipboardText(id,receipt)} };
            }
            var names = receipt["files"] as object[];
            if (names == null || names.Length < 1 || names.Length > 20 || index < -1 || index >= names.Length) throw new InvalidOperationException("无效的文件复制参数");
            var files = new List<string>();
            string directory = Path.Combine(dataRoot,"inbox",id);
            if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("无效的接收文件夹");
            for (int i=0;i<names.Length;i++) {
                if (index >= 0 && index != i) continue;
                string name = Convert.ToString(names[i]);
                if (String.IsNullOrEmpty(name) || Path.GetFileName(name) != name || name.IndexOf(':') >= 0) throw new InvalidOperationException("无效的接收文件名");
                string filename = Path.Combine(directory,name);
                if (!File.Exists(filename) || (File.GetAttributes(filename) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("接收文件已删除或不可用");
                long size = new FileInfo(filename).Length;
                if (size > 50L*1024*1024) throw new InvalidOperationException("接收文件过大");
                files.Add(filename);
            }
            bool image = files.Count == 1 && System.Text.RegularExpressions.Regex.IsMatch(files[0],"\\.(png|jpe?g)$",System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if (index >= 0 && !image) throw new InvalidOperationException("选中的文件不是支持复制的图片");
            return new Dictionary<string,object> { {"kind",image ? "image" : "files"}, {"files",files.ToArray()} };
        }
        private async Task CopyClipboardReceiptAsync(string id, int index)
        {
            if (clipboardCopying) { PostDesktopMessage(new { type="clipboard-copy", id=id, index=index, ok=false, error="正在复制，请稍后重试" }); return; }
            clipboardCopying = true;
            try {
                var request = CreateClipboardCopyRequest(id,index);
                string kind = Convert.ToString(request["kind"]);
                request["id"] = Guid.NewGuid().ToString("N");
                string message = Convert.ToBase64String(Encoding.UTF8.GetBytes(json.Serialize(request)));
                await Task.Run(delegate {
                    var start = new ProcessStartInfo(Path.Combine(root,"ClipboardWorker.exe")) { WorkingDirectory=root, UseShellExecute=false, CreateNoWindow=true, RedirectStandardInput=true, RedirectStandardOutput=true, RedirectStandardError=true, StandardOutputEncoding=Encoding.UTF8 };
                    start.EnvironmentVariables["PHONE_NOTIFY_DATA_DIR"] = dataRoot;
                    using (var process = Process.Start(start)) {
                        var output = process.StandardOutput.ReadToEndAsync(); var errors = process.StandardError.ReadToEndAsync();
                        process.StandardInput.WriteLine(message); process.StandardInput.Close();
                        if (!process.WaitForExit(20000)) { try { process.Kill(); } catch { } throw new InvalidOperationException("剪贴板复制超时，请重试"); }
                        var serializer = new JavaScriptSerializer();
                        foreach (string line in output.Result.Split(new[]{'\r','\n'},StringSplitOptions.RemoveEmptyEntries)) {
                            var reply = serializer.Deserialize<Dictionary<string,object>>(line);
                            object replyId;
                            if (!reply.TryGetValue("id",out replyId) || Convert.ToString(replyId) != Convert.ToString(request["id"])) continue;
                            if (Convert.ToBoolean(reply["ok"])) return;
                            throw new InvalidOperationException(Convert.ToString(reply["error"]));
                        }
                        throw new InvalidOperationException("剪贴板组件未完成复制，请重试");
                    }
                });
                PostDesktopMessage(new { type="clipboard-copy", id=id, index=index, ok=true, kind=kind });
            } catch (Exception error) { PostDesktopMessage(new { type="clipboard-copy", id=id, index=index, ok=false, error=error.Message }); }
            finally { clipboardCopying = false; }
        }
    }
}
