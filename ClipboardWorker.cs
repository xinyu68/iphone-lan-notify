using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace Xinyu.PhoneNotifications.ClipboardHost
{
    internal static class Program
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };
        private static DataObject snapshot;
        private static bool Diagnostics;
        [STAThread]
        private static void Main(string[] args)
        {
            Console.InputEncoding = new UTF8Encoding(false);
            Console.OutputEncoding = new UTF8Encoding(false);
            Diagnostics = args.Contains("--diagnostics");
            using (var dispatcher = new Control())
            using (var context = new ApplicationContext()) {
                IntPtr handle = dispatcher.Handle;
                Task.Run(delegate {
                    string line;
                    while ((line = Console.ReadLine()) != null) {
                        string request = line;
                        using (var finished = new ManualResetEvent(false)) {
                            dispatcher.BeginInvoke(new Action(delegate { try { ProcessRequest(request); } finally { finished.Set(); } }));
                            finished.WaitOne();
                        }
                    }
                    dispatcher.BeginInvoke(new Action(context.ExitThread));
                });
                Reply(new { op = "ready", ok = true });
                Application.Run(context);
            }
        }
        private static void ProcessRequest(string line)
        {
                bool diagnostics = Diagnostics;
                string id = "";
                try {
                    if (line.Length > 12 * 1024 * 1024) throw new InvalidOperationException("剪贴板请求过大");
                    var input = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(Convert.FromBase64String(line)));
                    id = Convert.ToString(input["id"]);
                    string kind = Convert.ToString(input["kind"]);
                    if (diagnostics && kind == "snapshot") {
                        var previous = Clipboard.GetDataObject();
                        snapshot = new DataObject();
                        if (previous != null) foreach (string format in previous.GetFormats(false)) {
                            object value = previous.GetData(format, false);
                            var stream = value as Stream;
                            if (stream != null) { var copy = new MemoryStream(); stream.Position = 0; stream.CopyTo(copy); copy.Position = 0; value = copy; }
                            var bitmap = value as Bitmap;
                            if (bitmap != null) value = new Bitmap(bitmap);
                            if (value != null && !(value is string) && !(value is Stream) && !(value is Bitmap) && !(value is byte[]) && !(value is string[])) throw new InvalidOperationException("无法无损保存这个应用专用剪贴板格式，取消测试");
                            if (value != null) snapshot.SetData(format, false, value);
                        }
                    } else if (diagnostics && kind == "restore") {
                        if (snapshot == null) throw new InvalidOperationException("没有剪贴板快照");
                        WriteClipboard(snapshot);
                    } else if (diagnostics && kind == "stall") {
                        Thread.Sleep(10000);
                    } else if (diagnostics && kind == "inspect") {
                        Reply(new { id = id, ok = true, text = Clipboard.ContainsText() ? Clipboard.GetText() : null,
                            files = Clipboard.ContainsFileDropList() ? Clipboard.GetFileDropList().Cast<string>().ToArray() : new string[0], image = Clipboard.ContainsImage() });
                        return;
                    } else {
                        var data = new DataObject();
                        if (kind == "text") {
                            string text = Convert.ToString(input["text"]);
                            if (text.Length == 0 || text.IndexOf('\0') >= 0) throw new InvalidOperationException("文字为空或包含不支持的字符");
                            data.SetText(text, TextDataFormat.UnicodeText);
                        } else if (kind == "files" || kind == "image") {
                            var items = (System.Collections.IEnumerable)input["files"];
                            var files = new StringCollection();
                            string root = Path.GetFullPath(Path.Combine(Environment.GetEnvironmentVariable("PHONE_NOTIFY_DATA_DIR"), "inbox")) + Path.DirectorySeparatorChar;
                            foreach (object item in items) {
                                string file = Path.GetFullPath(Convert.ToString(item));
                                if (!file.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(file)) throw new InvalidOperationException("无效的收件箱文件");
                                files.Add(file);
                            }
                            if (files.Count == 0 || files.Count > 20) throw new InvalidOperationException("文件数量无效");
                            data.SetFileDropList(files);
                            data.SetData("Preferred DropEffect", new MemoryStream(new byte[] { 1, 0, 0, 0 }));
                            if (kind == "image") {
                                if (files.Count != 1) throw new InvalidOperationException("图片剪贴板一次只支持一张图片");
                                using (var stream = File.OpenRead(files[0]))
                                using (var image = Image.FromStream(stream, true, true)) {
                                    if (image.Width > 16384 || image.Height > 16384 || (long)image.Width * image.Height > 40000000) throw new InvalidOperationException("图片尺寸过大");
                                    var bitmap = new Bitmap(image);
                                    data.SetImage(bitmap);
                                    var png = new MemoryStream(); bitmap.Save(png, System.Drawing.Imaging.ImageFormat.Png); png.Position = 0;
                                    data.SetData("PNG", false, png);
                                }
                            }
                        } else throw new InvalidOperationException("不支持的剪贴板类型");
                        WriteClipboard(data);
                    }
                    Reply(new { id = id, ok = true });
                } catch (Exception error) { Reply(new { id = id, ok = false, error = "无法写入剪贴板：剪贴板正忙、文件无效或图片无法解码，请重试", diagnostic = diagnostics ? error.GetType().Name + " (" + error.HResult + ")" : null }); }
        }
        private static void WriteClipboard(DataObject data)
        {
            for (int attempt = 0; ; attempt++) {
                try { Clipboard.SetDataObject(data, true, 10, 100); return; }
                catch (System.Runtime.InteropServices.ExternalException) {
                    if (attempt >= 2) throw;
                    Application.DoEvents(); Thread.Sleep(100);
                }
            }
        }
        private static void Reply(object value) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); }
    }
}
