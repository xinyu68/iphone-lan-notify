using System;
using System.IO;
using System.Drawing;
using System.Drawing.Imaging;
using System.Text;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Web.Script.Serialization;
namespace Xinyu.PhoneNotifications {
internal sealed partial class Controller {
    private string dataRoot;
    private string root;
    private string nodePath;
    private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength=8*1024*1024 };
    private bool clipboardEnabled, enabled, busy;
    private object lastMessage;
    private void SavePreference(bool value) { }
    private void StartReceiver() { }
    private Task StopReceiver() { return Task.FromResult(0); }
    private void Feedback(string value) { }
    private void PublishDesktopState() { }
    private void RefreshStatus() { }
    private void PostDesktopMessage(object value) { lastMessage=value; }
    private void RejectCopy(string id,int index=-1) {
        bool rejected=false;try{CreateClipboardCopyRequest(id,index);}catch{rejected=true;}
        if(!rejected)throw new Exception("Invalid stored-copy request accepted");
    }
    private void CheckStoredCopies(string id,string directory,bool live) {
        string text="\uFEFF\u4e2d\u6587 \ud83d\udccb\n"+new string('x',6000);
        Directory.CreateDirectory(Path.Combine(dataRoot,"clipboard-text"));
        File.WriteAllText(Path.Combine(dataRoot,"clipboard-text",id+".txt"),text,new UTF8Encoding(false));
        string saved=json.Serialize(new[]{new{id=id,kind="text",text="preview",textTruncated=true,files=new string[0]}});
        File.WriteAllText(Path.Combine(dataRoot,"clipboard-receipts.json"),saved,new UTF8Encoding(false));
        if(Convert.ToString(CreateClipboardCopyRequest(id,-1)["text"])!=text)throw new Exception("Stored copy used preview instead of full text");
        if(live) {
            CopyClipboardReceiptAsync(id,-1).GetAwaiter().GetResult();
            var result=json.Deserialize<Dictionary<string,object>>(json.Serialize(lastMessage));
            if(!Convert.ToBoolean(result["ok"]) || System.Windows.Forms.Clipboard.GetText()!=text)throw new Exception("Real stored-text copy failed");
        }
        if(File.ReadAllText(Path.Combine(dataRoot,"clipboard-receipts.json"))!=saved)throw new Exception("Copy changed receipt history");
        SaveReceipt(id,"sample.png");var request=CreateClipboardCopyRequest(id,-1);
        if(Convert.ToString(request["kind"])!="image" || ((string[])request["files"])[0]!=Path.Combine(directory,"sample.png"))throw new Exception("Stored image copy did not use original file");
        if(live) {
            CopyClipboardReceiptAsync(id,-1).GetAwaiter().GetResult();
            var result=json.Deserialize<Dictionary<string,object>>(json.Serialize(lastMessage));
            if(!Convert.ToBoolean(result["ok"]) || !System.Windows.Forms.Clipboard.ContainsImage() || !System.Windows.Forms.Clipboard.ContainsFileDropList())throw new Exception("Real stored-image copy failed");
            using(var image=System.Windows.Forms.Clipboard.GetImage())if(image.Width!=1600 || image.Height!=1200)throw new Exception("Copied thumbnail instead of full-size image");
        }
        SaveReceipt(id,"sample.jpg","files");if(Convert.ToString(CreateClipboardCopyRequest(id,0)["kind"])!="image")throw new Exception("Image file copy failed");
        RejectCopy(id,-2);RejectCopy(id,1);RejectCopy("../outside");RejectCopy(new string('b',32));
        SaveReceipt(id,"../sample.png");RejectCopy(id);
        SaveReceipt(id,"sample.png:stream");RejectCopy(id);
        SaveReceipt(id,"missing.png");RejectCopy(id);
        SaveReceipt(id,"unused","text");RejectCopy(id);
    }
    private void SaveReceipt(string id,string name,string kind="image") {
        File.WriteAllText(Path.Combine(dataRoot,"clipboard-receipts.json"),json.Serialize(new object[]{new{id=id,kind=kind,files=new[]{name}}}),new UTF8Encoding(false));
    }
    private void Reject(string id,int index) {
        bool rejected=false;try{ReadClipboardImage(id,index,false);}catch{rejected=true;}
        if(!rejected)throw new Exception("Invalid image request accepted");
    }
    private void CheckImage(string id,bool large,int width,int height) {
        string data=ReadClipboardImage(id,0,large),prefix="data:image/png;base64,";
        if(!data.StartsWith(prefix))throw new Exception("Expected PNG data URL");
        using(var stream=new MemoryStream(Convert.FromBase64String(data.Substring(prefix.Length))))
        using(var image=Image.FromStream(stream))if(image.Width!=width||image.Height!=height)throw new Exception("Unexpected preview size");
    }
    [STAThread]
    public static int Main(string[] args) {
        var c=new Controller();c.dataRoot=args[0];c.root=args.Length>1?args[1]:null;c.nodePath=Environment.GetEnvironmentVariable("PHONE_NOTIFY_TEST_NODE");string id=new string('a',32);
        string directory=Path.Combine(c.dataRoot,"inbox",id);Directory.CreateDirectory(directory);
        using(var image=new Bitmap(1600,1200)) {
            using(var g=Graphics.FromImage(image))g.Clear(Color.CornflowerBlue);
            image.Save(Path.Combine(directory,"sample.png"),ImageFormat.Png);
            image.Save(Path.Combine(directory,"sample.jpg"),ImageFormat.Jpeg);
            image.Save(Path.Combine(directory,"not-png.png"),ImageFormat.Gif);
        }
        c.SaveReceipt(id,"sample.png");c.CheckImage(id,false,224,168);c.CheckImage(id,true,1280,960);
        c.SaveReceipt(id,"sample.jpg","files");c.CheckImage(id,false,224,168);
        c.CheckStoredCopies(id,directory,args.Length>2 && args[2]=="--live-clipboard");
        File.Copy(Path.Combine(c.root,"test-fixtures","sample.heic"),Path.Combine(directory,"sample.heic"));
        c.SaveReceipt(id,"sample.heic","files");c.CheckImage(id,false,16,12);c.CheckImage(id,true,16,12);
        var heicCopy=c.CreateClipboardCopyRequest(id,-1);if(Convert.ToString(heicCopy["kind"])!="image" || !((string[])heicCopy["files"])[0].EndsWith(".png"))throw new Exception("HEIC clipboard conversion failed");
        if(args.Length>2 && args[2]=="--live-clipboard") {
            c.CopyClipboardReceiptAsync(id,-1).GetAwaiter().GetResult();
            var reply=c.json.Deserialize<Dictionary<string,object>>(c.json.Serialize(c.lastMessage));
            if(!Convert.ToBoolean(reply["ok"]) || !System.Windows.Forms.Clipboard.ContainsImage())throw new Exception("HEIC Windows clipboard copy failed");
            using(var image=System.Windows.Forms.Clipboard.GetImage())if(image.Width!=16 || image.Height!=12)throw new Exception("HEIC clipboard size mismatch");
        }
        c.Reject("../outside",0);c.Reject(new string('b',32),0);c.Reject(id,-1);c.Reject(id,20);c.Reject(id,1);
        c.SaveReceipt(id,"../sample.png");c.Reject(id,0);
        c.SaveReceipt(id,"sample.png:stream");c.Reject(id,0);
        c.SaveReceipt(id,"not-png.png");c.Reject(id,0);
        c.SaveReceipt(id,"sample.png","text");c.Reject(id,0);
        File.WriteAllText(Path.Combine(directory,"broken.png"),"invalid image");c.SaveReceipt(id,"broken.png");c.Reject(id,0);
        using(var image=new Bitmap(17000,1))image.Save(Path.Combine(directory,"wide.png"),ImageFormat.Png);
        c.SaveReceipt(id,"wide.png");c.Reject(id,0);
        using(var stream=File.Create(Path.Combine(directory,"large.png")))stream.SetLength(51L*1024*1024);
        c.SaveReceipt(id,"large.png");c.Reject(id,0);
        c.SaveReceipt(id,"deleted.png");c.Reject(id,0);
        Console.WriteLine("PASS: PNG/JPEG/HEIC previews, stored full-text/original-image copy requests, disabled receiver, unchanged history, record/path/index bounds, format/size limits and missing content"+(args.Length>2?"; real Windows text/image/HEIC clipboard copies verified":""));return 0;
    }
}}
