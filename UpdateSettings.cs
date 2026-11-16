using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace Xinyu.PhoneNotifications
{
    internal sealed partial class Controller
    {
        private string updatePhase = "idle", updateError = "", latestVersion = "", updateNotes = "";
        private int updatePercent;
        private bool updateBusy;
        private DateTime updateResultTime = DateTime.MinValue;
        private object UpdateState()
        {
            try {
                string file=Path.Combine(dataRoot,"update-result.json");
                if(File.Exists(file)&&File.GetLastWriteTimeUtc(file)!=updateResultTime&&!updateBusy){
                    updateResultTime=File.GetLastWriteTimeUtc(file);
                    var saved=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(file,Encoding.UTF8));
                    if(Convert.ToBoolean(saved["ok"])&&Convert.ToString(saved["version"])==AppVersion.Current)updatePhase="updated";
                    else if(!Convert.ToBoolean(saved["ok"])){updatePhase="error";updateError="上次更新未完成，仍在使用当前版本。"+Convert.ToString(saved["error"]);}
                }
            } catch { }
            return new { current=AppVersion.Current, phase=updatePhase, error=updateError, latest=latestVersion, notes=updateNotes, percent=updatePercent };
        }
        private async Task CheckUpdateAsync()
        {
            if (updateBusy) return;
            updateBusy=true; updatePhase="checking"; updateError=""; latestVersion=""; updateNotes=""; PublishDesktopState();
            try {
                var reply=await UpdateCommandAsync(new {action="check",current=AppVersion.Current});
                latestVersion=Convert.ToString(reply["version"]);updateNotes=Convert.ToString(reply["notes"]);
                updatePhase=Convert.ToBoolean(reply["available"]) ? "available" : "current";
            } catch(Exception error) {updatePhase="error";updateError=error.Message;}
            finally {updateBusy=false;PublishDesktopState();}
        }
        private Task<Dictionary<string,object>> UpdateCommandAsync(object request)
        {
            return Task.Run(delegate {
                var serializer=new JavaScriptSerializer { MaxJsonLength=1024*1024 };
                var start=new ProcessStartInfo(nodePath,"\""+Path.Combine(root,"updater.cjs")+"\"") {WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8};
                Dictionary<string,object> result=null;
                using(var process=Process.Start(start)) {
                    var errors=process.StandardError.ReadToEndAsync();
                    process.OutputDataReceived+=delegate(object sender,DataReceivedEventArgs e) {
                        if(String.IsNullOrEmpty(e.Data)||e.Data.Length>1024*1024)return;
                        try {
                            var message=new JavaScriptSerializer {MaxJsonLength=1024*1024}.Deserialize<Dictionary<string,object>>(e.Data);
                            if(Convert.ToString(message["type"])=="result")result=message;
                            else if(Convert.ToString(message["type"])=="progress") {
                                int value=Math.Max(0,Math.Min(100,Convert.ToInt32(message["percent"])));
                                if(!exiting&&!form.IsDisposed)form.BeginInvoke(new Action(delegate {updatePercent=value;PublishDesktopState();}));
                            }
                        } catch { }
                    };
                    process.BeginOutputReadLine();
                    process.StandardInput.WriteLine(serializer.Serialize(request));process.StandardInput.Close();
                    if(!process.WaitForExit(240000)){try{process.Kill();}catch{}throw new InvalidOperationException("更新请求超时，请稍后重试");}
                    process.WaitForExit();
                    if(result==null)throw new InvalidOperationException("更新组件未返回结果，请稍后重试");
                    if(!Convert.ToBoolean(result["ok"]))throw new InvalidOperationException(Convert.ToString(result["error"]));
                    return result;
                }
            });
        }
        private async Task InstallUpdateAsync()
        {
            if(updateBusy||busy||updatePhase!="available"||String.IsNullOrEmpty(latestVersion))return;
            updateBusy=true;busy=true;updatePhase="downloading";updatePercent=0;updateError="";PublishDesktopState();
            try {
                var reply=await UpdateCommandAsync(new {action="download",current=AppVersion.Current,target=latestVersion,dataRoot=dataRoot});
                string stage=Path.GetFullPath(Convert.ToString(reply["stage"]));
                string expected=Path.GetFullPath(Path.Combine(dataRoot,".updates"))+Path.DirectorySeparatorChar;
                if(!stage.StartsWith(expected,StringComparison.OrdinalIgnoreCase)||!System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(stage),"\\A[a-f0-9]{32}\\z"))throw new InvalidOperationException("更新缓存目录无效");
                File.Copy(Path.Combine(root,"apply-update.ps1"),Path.Combine(stage,"apply-update.ps1"),false);
                updatePhase="installing";PublishDesktopState();
                string arguments="-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \""+Path.Combine(stage,"apply-update.ps1")+"\" -AppRoot \""+root.TrimEnd(Path.DirectorySeparatorChar)+"\" -DataRoot \""+dataRoot.TrimEnd(Path.DirectorySeparatorChar)+"\" -Stage \""+stage+"\" -ParentId "+Process.GetCurrentProcess().Id;
                string shell=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe");
                using(var installer=Process.Start(new ProcessStartInfo(shell,arguments){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=stage})) {
                    try {
                    string ready=Path.Combine(stage,"ready.json");DateTime deadline=DateTime.UtcNow.AddSeconds(60);
                    while(!File.Exists(ready)&&!installer.HasExited&&DateTime.UtcNow<deadline)await Task.Delay(200);
                    if(!File.Exists(ready))throw new InvalidOperationException("更新校验未通过，程序保持原版本。请稍后重试或到 Releases 下载完整包");
                    busy=false;
                    await ExitProgram();
                    if(!exiting)throw new InvalidOperationException("接收程序暂时无法退出，更新尚未安装，请稍后重试");
                    } finally {if(!exiting&&!installer.HasExited){try{installer.Kill();}catch{}}}
                }
            } catch(Exception error){busy=false;updatePhase="error";updateError=error.Message;}
            finally {updateBusy=false;if(!exiting)PublishDesktopState();}
        }
    }
}
