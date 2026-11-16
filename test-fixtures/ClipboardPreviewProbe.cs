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
    private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength=8*1024*1024 };
    private bool clipboardEnabled, enabled, busy;
    private void SavePreference(bool value) { }
    private void StartReceiver() { }
    private Task StopReceiver() { return Task.FromResult(0); }
    private void Feedback(string value) { }
    private void PublishDesktopState() { }
    private void RefreshStatus() { }
    private void PostDesktopMessage(object value) { }
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
    public static int Main(string[] args) {
        var c=new Controller();c.dataRoot=args[0];string id=new string('a',32);
        string directory=Path.Combine(c.dataRoot,"inbox",id);Directory.CreateDirectory(directory);
        using(var image=new Bitmap(1600,1200)) {
            using(var g=Graphics.FromImage(image))g.Clear(Color.CornflowerBlue);
            image.Save(Path.Combine(directory,"sample.png"),ImageFormat.Png);
            image.Save(Path.Combine(directory,"sample.jpg"),ImageFormat.Jpeg);
            image.Save(Path.Combine(directory,"not-png.png"),ImageFormat.Gif);
        }
        c.SaveReceipt(id,"sample.png");c.CheckImage(id,false,224,168);c.CheckImage(id,true,1280,960);
        c.SaveReceipt(id,"sample.jpg","files");c.CheckImage(id,false,224,168);
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
        Console.WriteLine("PASS: native PNG/JPEG thumbnails and enlarged images, disabled receiver, record/path/index bounds, format/size/dimension limits and deleted images");return 0;
    }
}}
