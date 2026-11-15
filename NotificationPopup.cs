using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Media;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace Xinyu.PhoneNotifications.Popup
{
    internal static class Program
    {
        private static readonly object OutputLock = new object();
        private static TextReader Input;
        private static TextWriter Output;
        internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

        [STAThread]
        private static void Main(string[] args)
        {
            try
            {
                Input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false), false);
                Output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
                var application = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
                var manager = new PopupManager(args.Contains("--diagnostics"));
                application.Startup += delegate {
                    Reply(new { op = "ready", ok = true, presentation = "app-icon" });
                    Task.Run(delegate { ReadInput(application, manager); });
                };
                application.Exit += delegate { manager.Stop(); };
                application.Run();
            }
            catch (Exception error) { if (Output != null) Reply(new { op = "ready", ok = false, error = error.GetType().Name }); Environment.ExitCode = 1; }
        }

        private static void ReadInput(Application application, PopupManager manager)
        {
            try
            {
                string line;
                while ((line = Input.ReadLine()) != null)
                {
                    Dictionary<string, object> message;
                    try
                    {
                        if (line.Length > 65536) throw new InvalidDataException("Input limit exceeded");
                        string content = Encoding.UTF8.GetString(Convert.FromBase64String(line));
                        message = Json.Deserialize<Dictionary<string, object>>(content);
                    }
                    catch (Exception error) { Reply(new { ok = false, error = error.GetType().Name }); continue; }
                    var request = message;
                    application.Dispatcher.Invoke(new Action(delegate { manager.Handle(request); }));
                }
            }
            catch (IOException) { }
            catch (TaskCanceledException) { }
            catch (InvalidOperationException) { }
            finally
            {
                try { application.Dispatcher.BeginInvoke(new Action(delegate { manager.Stop(); application.Shutdown(); })); }
                catch (InvalidOperationException) { }
            }
        }

        internal static void Reply(object value)
        {
            lock (OutputLock) { Output.WriteLine(new JavaScriptSerializer().Serialize(value)); Output.Flush(); }
        }

        internal static string Text(Dictionary<string, object> value, string key, string fallback, int limit)
        {
            object entry;
            string text = value.TryGetValue(key, out entry) ? Convert.ToString(entry) : fallback;
            text = (text ?? fallback).Trim();
            if (text.Length == 0) text = fallback;
            return text.Length <= limit ? text : text.Substring(0, limit);
        }

        internal static SolidColorBrush Brush(string color) { return new SolidColorBrush((Color)ColorConverter.ConvertFromString(color)); }
    }

    internal sealed class PopupManager
    {
        private readonly List<NotificationWindow> active = new List<NotificationWindow>();
        private readonly Queue<Dictionary<string, object>> waiting = new Queue<Dictionary<string, object>>();
        private readonly bool diagnostics;
        private bool stopped;

        internal PopupManager(bool diagnostics)
        {
            this.diagnostics = diagnostics;
            SystemParameters.StaticPropertyChanged += ParametersChanged;
        }

        internal void Handle(Dictionary<string, object> message)
        {
            string id = Program.Text(message, "id", "", 64);
            try
            {
                string operation = Program.Text(message, "op", "notify", 32);
                if (diagnostics && (operation == "exercise-open" || operation == "exercise-dismiss"))
                {
                    string targetId = Program.Text(message, "targetId", "", 64);
                    var target = active.Single(window => window.NotificationId == targetId);
                    target.ExerciseInteraction(operation == "exercise-open");
                    Program.Reply(new { id = id, ok = true });
                    return;
                }
                if (operation == "inspect")
                {
                    Rect area = SystemParameters.WorkArea;
                    Program.Reply(new {
                        id = id, ok = true, presentation = "app-icon", processId = Process.GetCurrentProcess().Id,
                        activeCount = active.Count, queuedCount = waiting.Count, iconCount = active.Sum(window => window.IconCount),
                        workArea = new { left = area.Left, top = area.Top, right = area.Right, bottom = area.Bottom },
                        windows = active.Select(window => window.Snapshot()).ToArray()
                    });
                    return;
                }
                if (operation != "notify") throw new InvalidDataException("Unknown operation");
                if (active.Count >= Capacity())
                {
                    if (waiting.Count >= 30) waiting.Dequeue();
                    waiting.Enqueue(message);
                    Program.Reply(new { id = id, ok = true, presentation = "app-icon", queued = true });
                    return;
                }
                var shown = Show(message);
                Program.Reply(new { id = id, ok = true, presentation = "app-icon", queued = false, iconSource = shown.IconSource });
            }
            catch (Exception error) { Program.Reply(new { id = id, ok = false, error = error.GetType().Name }); }
        }

        private int Capacity() { return Math.Max(1, Math.Min(3, (int)((SystemParameters.WorkArea.Height - 16) / 96))); }

        private NotificationWindow Show(Dictionary<string, object> message)
        {
            var window = new NotificationWindow(message, diagnostics);
            active.Add(window);
            window.Closed += delegate {
                active.Remove(window);
                if (stopped) return;
                while (waiting.Count > 0 && active.Count < Capacity()) Show(waiting.Dequeue());
                Reflow();
            };
            Reflow();
            window.Show();
            return window;
        }

        private void Reflow()
        {
            Rect area = SystemParameters.WorkArea;
            int offset = 0;
            for (int index = active.Count - 1; index >= 0; index--)
            {
                active[index].Left = area.Right - active[index].Width;
                active[index].Top = area.Bottom - active[index].Height - offset;
                offset += 96;
            }
        }

        private void ParametersChanged(object sender, System.ComponentModel.PropertyChangedEventArgs args) { if (!stopped) Reflow(); }

        internal void Stop()
        {
            if (stopped) return;
            stopped = true;
            SystemParameters.StaticPropertyChanged -= ParametersChanged;
            waiting.Clear();
            foreach (var window in active.ToArray()) window.Close();
            active.Clear();
        }
    }

    internal sealed class NotificationWindow : Window
    {
        private readonly Border card;
        private readonly string notificationId;
        private readonly string notifierAppId;
        internal string NotificationId { get { return notificationId; } }
        private readonly bool diagnostics;
        private readonly DispatcherTimer timer = new DispatcherTimer();
        private readonly Stopwatch elapsed = new Stopwatch();
        private double remaining = 5000;
        private bool dismissing;
        private readonly bool silent;
        private readonly Image appIcon;
        private readonly TextBlock attribution;
        internal string IconSource { get; private set; }
        internal int IconCount { get { return appIcon.Source != null ? 1 : 0; } }

        internal NotificationWindow(Dictionary<string, object> message, bool diagnostics)
        {
            this.diagnostics = diagnostics;
            notificationId = Program.Text(message, "id", "", 64);
            notifierAppId = Program.Text(message, "notifierAppId", "Xinyu.IPhoneLanNotify", 120);
            object sound;
            silent = message.TryGetValue("silent", out sound) && Convert.ToBoolean(sound);
            Title = "手机通知";
            Width = 431; Height = 115;
            WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize;
            AllowsTransparency = true; Background = Brushes.Transparent;
            ShowActivated = false; ShowInTaskbar = false; Topmost = true;
            FontFamily = new FontFamily("Microsoft YaHei UI");
            UseLayoutRounding = true; SnapsToDevicePixels = true;
            card = new Border {
                Margin = new Thickness(19, 19, 8, 8), Padding = new Thickness(16, 11, 15, 10),
                Background = Brushes.White, BorderBrush = Program.Brush("#E8ECE3"), BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(11),
                Effect = new DropShadowEffect { Color = Color.FromRgb(20, 35, 16), BlurRadius = 20, ShadowDepth = 4, Opacity = .2 }
            };
            Content = card;
            card.Cursor = Cursors.Hand;
            System.Windows.Automation.AutomationProperties.SetName(card, "打开手机通知并查看这条消息");
            var columns = new Grid(); card.Child = columns;
            columns.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(48) });
            columns.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            appIcon = new Image {
                Width = 36, Height = 36, Stretch = Stretch.UniformToFill,
                VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Left,
                Source = LoadIcon(message), Clip = CreateIosStyleMask(36)
            };
            RenderOptions.SetBitmapScalingMode(appIcon, BitmapScalingMode.HighQuality);
            columns.Children.Add(appIcon);
            var rows = new Grid { Height = 64, VerticalAlignment = VerticalAlignment.Center }; Grid.SetColumn(rows, 1); columns.Children.Add(rows);
            rows.RowDefinitions.Add(new RowDefinition { Height = new GridLength(24) });
            rows.RowDefinitions.Add(new RowDefinition { Height = new GridLength(22) });
            rows.RowDefinitions.Add(new RowDefinition { Height = new GridLength(18) });
            var header = new DockPanel(); rows.Children.Add(header);
            var close = new Button {
                Content = "×", FontSize = 17, Width = 17, Height = 17, Padding = new Thickness(0),
                Background = Brushes.Transparent, BorderThickness = new Thickness(0),
                Foreground = Program.Brush("#9AA391"), Cursor = Cursors.Hand
            };
            System.Windows.Automation.AutomationProperties.SetName(close, "关闭通知");
            close.Click += delegate { Dismiss(); };
            card.MouseLeftButtonUp += delegate(object senderObject, MouseButtonEventArgs args) {
                if (!close.IsMouseOver) OpenNotification();
            };
            DockPanel.SetDock(close, Dock.Right); header.Children.Add(close);
            string title = Program.Text(message, "title", "iPhone 通知", 200);
            string content = Program.Text(message, "body", "", 8000);
            var sender = new TextBlock { Text = OneLine(title), FontSize = 14, FontWeight = FontWeights.SemiBold, Foreground = Program.Brush("#2B3327"), TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center };
            header.Children.Add(sender);
            var body = new TextBlock { Text = OneLine(content), FontSize = 12, Foreground = Program.Brush("#6F7B65"), TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetRow(body, 1); rows.Children.Add(body);
            var tooltip = new TextBlock { Text = title + "\n" + content, TextWrapping = TextWrapping.Wrap, MaxWidth = 380, MaxHeight = 450 };
            body.ToolTip = tooltip;
            string appName = OneLine(Program.Text(message, "appName", "iPhone", 80));
            string attributionText = String.Equals(appName, "iPhone", StringComparison.OrdinalIgnoreCase) ? "来自 iPhone" : appName + " • 来自 iPhone";
            attribution = new TextBlock { Text = attributionText, FontSize = 9, Foreground = Program.Brush("#9BA58F"), TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Bottom };
            Grid.SetRow(attribution, 2); rows.Children.Add(attribution);
            timer.Interval = TimeSpan.FromMilliseconds(40);
            timer.Tick += delegate {
                double passed = elapsed.Elapsed.TotalMilliseconds; elapsed.Restart();
                if (!IsMouseOver && !IsKeyboardFocusWithin) remaining -= passed;
                if (remaining <= 0) Dismiss();
            };
            Loaded += delegate {
                BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(160)));
                elapsed.Restart(); timer.Start();
                if (!silent) { try { SystemSounds.Asterisk.Play(); } catch (InvalidOperationException) { } }
                if (diagnostics)
                {
                    var captureTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
                    captureTimer.Tick += delegate { captureTimer.Stop(); CaptureOwnWindow(); };
                    captureTimer.Start();
                }
            };
            Closed += delegate { timer.Stop(); elapsed.Stop(); };
            PreviewKeyDown += delegate(object senderObject, KeyEventArgs args) {
                if (args.Key == Key.Escape) Dismiss();
                else if (args.Key == Key.Enter && !close.IsKeyboardFocusWithin) { OpenNotification(); args.Handled = true; }
            };
        }

        private static string OneLine(string text) { return text.Replace("\r", " ").Replace("\n", " ").Replace("\t", " "); }

        private void OpenNotification()
        {
            if (dismissing || !System.Text.RegularExpressions.Regex.IsMatch(notificationId, "\\A[a-f0-9]{16}\\z")) return;
            try
            {
                string executable = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "PhoneNotify.exe");
                using (Process process = Process.Start(new ProcessStartInfo(executable, "--notification " + notificationId) {
                    UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = AppDomain.CurrentDomain.BaseDirectory
                })) { }
                Program.Reply(new { op = "notification-opened", notificationId = notificationId, notifierAppId = notifierAppId });
                Dismiss();
            }
            catch (System.ComponentModel.Win32Exception) { }
            catch (IOException) { }
        }

        internal void ExerciseInteraction(bool open)
        {
            if (!diagnostics) throw new InvalidOperationException("Diagnostics required");
            if (open) OpenNotification(); else Dismiss();
        }

        private void Dismiss()
        {
            if (dismissing) return;
            dismissing = true; timer.Stop();
            var animation = new DoubleAnimation(0, TimeSpan.FromMilliseconds(140));
            animation.Completed += delegate { Close(); };
            BeginAnimation(OpacityProperty, animation);
        }

        internal object Snapshot()
        {
            return new {
                id = notificationId, visible = IsVisible, topmost = Topmost, active = IsActive,
                showActivated = ShowActivated, paused = IsMouseOver || IsKeyboardFocusWithin,
                remainingMilliseconds = Math.Max(0, (int)remaining),
                cardLeft = Left + 19, cardTop = Top + 19, cardRight = Left + Width - 8, cardBottom = Top + Height - 8,
                iconCount = IconCount, iconSource = IconSource, iconWidth = appIcon.ActualWidth, iconHeight = appIcon.ActualHeight,
                cardWidth = card.ActualWidth, cardHeight = card.ActualHeight,
                iconMask = "continuous-superellipse", attribution = attribution.Text
            };
        }

        private void CaptureOwnWindow()
        {
            if (!diagnostics || !IsVisible || dismissing) return;
            try
            {
                string directory = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".verification");
                Directory.CreateDirectory(directory);
                string safeId = new string(notificationId.Where(Char.IsLetterOrDigit).Take(32).ToArray());
                if (safeId.Length == 0) return;
                UpdateLayout();
                var image = new RenderTargetBitmap((int)Math.Ceiling(ActualWidth), (int)Math.Ceiling(ActualHeight), 96, 96, PixelFormats.Pbgra32);
                image.Render(this);
                var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(image));
                using (var output = File.Create(Path.Combine(directory, "popup-" + safeId + ".png"))) encoder.Save(output);
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        private BitmapSource LoadIcon(Dictionary<string, object> message)
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string requested = Program.Text(message, "iconPath", "", 2048);
            string source = Program.Text(message, "iconSource", "phone-notify", 32);
            if (source == "appstore" && requested.Length > 0)
            {
                try
                {
                    string file = Path.GetFullPath(requested);
                    string cache = Path.Combine(Environment.GetEnvironmentVariable("PHONE_NOTIFY_DATA_DIR") ?? root, ".icon-cache") + Path.DirectorySeparatorChar;
                    string bundled = Path.Combine(root, "assets", "app-icons") + Path.DirectorySeparatorChar;
                    if ((file.StartsWith(cache, StringComparison.OrdinalIgnoreCase) || file.StartsWith(bundled, StringComparison.OrdinalIgnoreCase)) && File.Exists(file))
                    {
                        var bitmap = new BitmapImage();
                        bitmap.BeginInit(); bitmap.CacheOption = BitmapCacheOption.OnLoad;
                        bitmap.CreateOptions = BitmapCreateOptions.IgnoreImageCache; bitmap.DecodePixelWidth = 100;
                        bitmap.UriSource = new Uri(file); bitmap.EndInit(); bitmap.Freeze();
                        IconSource = "appstore";
                        return bitmap;
                    }
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
                catch (FormatException) { }
                catch (NotSupportedException) { }
            }
            using (var stream = System.Reflection.Assembly.GetExecutingAssembly().GetManifestResourceStream("PhoneNotifyFallback.png"))
            {
                var bitmap = new BitmapImage();
                bitmap.BeginInit(); bitmap.CacheOption = BitmapCacheOption.OnLoad; bitmap.DecodePixelWidth = 100;
                bitmap.StreamSource = stream; bitmap.EndInit(); bitmap.Freeze();
                IconSource = "phone-notify";
                return bitmap;
            }
        }

        private static Geometry CreateIosStyleMask(double size)
        {
            // Continuous curvature, unlike a four-arc rounded rectangle.
            // Apple applies a system mask on iPhone; this n=5 contour recreates its rounded-square appearance.
            var geometry = new StreamGeometry();
            double radius = size / 2;
            using (var context = geometry.Open())
            {
                context.BeginFigure(new Point(radius, 0), true, true);
                for (int step = 1; step <= 256; step++)
                {
                    double angle = -Math.PI / 2 + step * 2 * Math.PI / 256;
                    double cosine = Math.Cos(angle), sine = Math.Sin(angle);
                    double x = radius + radius * Math.Sign(cosine) * Math.Pow(Math.Abs(cosine), .4);
                    double y = radius + radius * Math.Sign(sine) * Math.Pow(Math.Abs(sine), .4);
                    context.LineTo(new Point(x, y), true, false);
                }
            }
            geometry.Freeze();
            return geometry;
        }
    }
}
