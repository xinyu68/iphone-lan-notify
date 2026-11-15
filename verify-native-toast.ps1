param(
    [Parameter(Mandatory=$true)][ValidatePattern('\AXinyu\.IPhoneLanNotify(?:\.Source\.[a-f0-9]{24})?\z')][string]$SourceId,
    [Parameter(Mandatory=$true)][ValidatePattern('\A[a-f0-9]{16}\z')][string]$NotificationId
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("53E31837-6600-4A81-9395-75CFFE746F94"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPhoneNativeToastCallback {
    void Activate([MarshalAs(UnmanagedType.LPWStr)] string source, [MarshalAs(UnmanagedType.LPWStr)] string arguments, IntPtr data, uint count);
}
public static class PhoneNativeToastProbe {
    public static void Invoke(string source, string id) {
        object instance = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("F493D55B-4C7A-41DB-A632-524394C4B49E")));
        try { ((IPhoneNativeToastCallback)instance).Activate(source, "notification=" + id, IntPtr.Zero, 0); }
        finally { Marshal.FinalReleaseComObject(instance); }
    }
}
'@
[PhoneNativeToastProbe]::Invoke($SourceId, $NotificationId)
$notifyDeadline = (Get-Date).AddSeconds(20)
do {
    Start-Sleep -Milliseconds 200
    $notifyState = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'controller-state.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($notifyState.selectedNotificationId -eq $NotificationId -and $notifyState.activationSource -eq 'windows-toast' -and $notifyState.webReady) {
        Write-Output 'PASS: Windows COM activation opens the application with the requested notification ID'
        exit 0
    }
} while ((Get-Date) -lt $notifyDeadline)
throw 'Native activation did not reach the requested notification'
