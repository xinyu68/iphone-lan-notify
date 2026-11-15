using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace Xinyu.PhoneNotifications.Native
{
    [ComVisible(true), Guid("53E31837-6600-4A81-9395-75CFFE746F94"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface INotificationActivationCallback
    {
        void Activate([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId, [MarshalAs(UnmanagedType.LPWStr)] string invokedArgs, IntPtr data, uint dataCount);
    }

    [ComVisible(true), Guid("F493D55B-4C7A-41DB-A632-524394C4B49E"), ClassInterface(ClassInterfaceType.None)]
    public class NotificationActivator : INotificationActivationCallback
    {
        public const string ClassId = "{F493D55B-4C7A-41DB-A632-524394C4B49E}";
        public static Action<string> OpenNotification;
        public void Activate(string appUserModelId, string invokedArgs, IntPtr data, uint dataCount)
        {
            if (!ToastSourceRegistration.ValidSource(appUserModelId) || !Regex.IsMatch(invokedArgs ?? "", "\\Anotification=[a-f0-9]{16}\\z")) return;
            var callback = OpenNotification;
            if (callback != null) {
                try { callback(invokedArgs.Substring(13)); }
                catch (ObjectDisposedException) { }
                catch (InvalidOperationException) { }
            }
        }
    }

    public static class ToastSourceRegistration
    {
        private static readonly Dictionary<string, string> Registered = new Dictionary<string, string>();
        private static readonly Guid AppPropertySet = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
        public static bool ValidSource(string source) { return Regex.IsMatch(source ?? "", "\\AXinyu\\.IPhoneLanNotify(?:\\.Source\\.[a-f0-9]{24})?\\z"); }

        public static void RegisterServer(string root)
        {
            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Classes\CLSID\" + NotificationActivator.ClassId + @"\LocalServer32"))
                key.SetValue("", "\"" + Path.Combine(root, "PhoneNotify.exe") + "\" --toast-activated");
        }

        public static string RegisterSource(string root, string source, string displayName, string imagePath)
        {
            if (!ValidSource(source)) throw new ArgumentException("Invalid notification source");
            string icon = IconFile(root, imagePath);
            string fingerprint = root + "\0" + displayName + "\0" + icon;
            string previous;
            if (Registered.TryGetValue(source, out previous) && previous == fingerprint) return icon;
            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Classes\AppUserModelId\" + source))
            {
                key.SetValue("DisplayName", displayName, RegistryValueKind.ExpandString);
                key.SetValue("IconUri", icon, RegistryValueKind.ExpandString);
                key.SetValue("IconBackgroundColor", "#00000000");
                key.SetValue("CustomActivator", NotificationActivator.ClassId);
            }
            string folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "手机通知来源");
            Directory.CreateDirectory(folder);
            string label = Regex.Replace(displayName ?? "手机通知", "[\\x00-\\x1f<>:\"/\\\\|?*]", "_").Trim().TrimEnd('.');
            if (label.Length > 40) label = label.Substring(0, 40);
            if (label.Length == 0) label = "手机通知";
            string shortcut = Path.Combine(folder, label + " - " + source.Substring(Math.Max(0, source.Length - 8)) + ".lnk");
            bool shortcutExisted = File.Exists(shortcut);
            object shell = new ShellLink();
            try
            {
                var link = (IShellLinkW)shell;
                link.SetPath(Path.Combine(root, "PhoneNotify.exe"));
                link.SetArguments(""); link.SetWorkingDirectory(root);
                link.SetDescription("手机通知 · " + displayName);
                link.SetIconLocation(icon, 0);
                var store = (IPropertyStore)shell;
                SetString(store, 5, source);
                var key = new PropertyKey { FormatId = AppPropertySet, PropertyId = 26 };
                IntPtr pointer = Marshal.AllocCoTaskMem(16);
                try
                {
                    Marshal.StructureToPtr(new Guid(NotificationActivator.ClassId), pointer, false);
                    var value = new PropVariant { Type = 72, Pointer = pointer };
                    store.SetValue(ref key, ref value);
                }
                finally { Marshal.FreeCoTaskMem(pointer); }
                store.Commit();
                ((IPersistFile)shell).Save(shortcut, true);
                SHChangeNotify(shortcutExisted ? 0x00002000u : 0x00000002u, 0x2005, shortcut, IntPtr.Zero);
            }
            finally { Marshal.FinalReleaseComObject(shell); }
            Registered[source] = fingerprint;
            return icon;
        }

        private static void SetString(IPropertyStore store, uint property, string text)
        {
            var key = new PropertyKey { FormatId = AppPropertySet, PropertyId = property };
            IntPtr pointer = Marshal.StringToCoTaskMemUni(text);
            try { var value = new PropVariant { Type = 31, Pointer = pointer }; store.SetValue(ref key, ref value); }
            finally { Marshal.FreeCoTaskMem(pointer); }
        }

        private static string IconFile(string root, string imagePath)
        {
            string fallback = Path.Combine(root, "assets", "app-no-bell.ico");
            string file = String.IsNullOrEmpty(imagePath) ? "" : Path.GetFullPath(imagePath);
            string cache = Path.Combine(Environment.GetEnvironmentVariable("PHONE_NOTIFY_DATA_DIR") ?? root, ".icon-cache") + Path.DirectorySeparatorChar;
            if (!file.StartsWith(cache, StringComparison.OrdinalIgnoreCase) || !File.Exists(file) || !file.EndsWith(".png", StringComparison.OrdinalIgnoreCase)) return fallback;
            string output = Path.ChangeExtension(file, ".ico");
            if (File.Exists(output)) return output;
            byte[] png = File.ReadAllBytes(file);
            using (var writer = new BinaryWriter(File.Create(output)))
            {
                writer.Write((ushort)0); writer.Write((ushort)1); writer.Write((ushort)1);
                writer.Write((byte)0); writer.Write((byte)0); writer.Write((byte)0); writer.Write((byte)0);
                writer.Write((ushort)1); writer.Write((ushort)32); writer.Write((uint)png.Length); writer.Write((uint)22); writer.Write(png);
            }
            return output;
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        private static extern void SHChangeNotify(uint eventId, uint flags, string item, IntPtr other);
        [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
        private class ShellLink { }
        [StructLayout(LayoutKind.Sequential)]
        private struct PropertyKey { public Guid FormatId; public uint PropertyId; }
        [StructLayout(LayoutKind.Explicit, Size = 24)]
        private struct PropVariant { [FieldOffset(0)] public ushort Type; [FieldOffset(8)] public IntPtr Pointer; }
        [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IPropertyStore
        {
            void GetCount(out uint count); void GetAt(uint index, out PropertyKey key); void GetValue(ref PropertyKey key, out PropVariant value);
            void SetValue(ref PropertyKey key, ref PropVariant value); void Commit();
        }
        [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IShellLinkW
        {
            void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int count, IntPtr data, uint flags);
            void GetIDList(out IntPtr list); void SetIDList(IntPtr list);
            void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int count); void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string text);
            void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int count); void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string text);
            void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int count); void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string text);
            void GetHotkey(out short hotkey); void SetHotkey(short hotkey); void GetShowCmd(out int command); void SetShowCmd(int command);
            void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder icon, int count, out int index); void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string icon, int index);
            void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved); void Resolve(IntPtr window, uint flags); void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
        }
    }
}
