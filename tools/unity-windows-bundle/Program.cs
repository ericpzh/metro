using System.Diagnostics;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

namespace Metro.WindowsBundle;

internal static class Program {
    private static readonly byte[] FooterMagic = Encoding.ASCII.GetBytes("METRO_BUNDLE_V1\0");
    private const int FooterBytes = 16 + 8 + 8 + 16 + 8; // magic + offset + length + hash16 + version = 56
    private const string ReadyMarkerName = ".metro-bundle-ready";
    private const string PlayerExeName = "MetroStation.exe";

    [STAThread]
    private static int Main(string[] args) {
        bool headless = false;
        try {
            bool verifyOnly = false;
            bool extractOnly = false;
            string? explicitBundleFile = null;
            var forwardArgs = new List<string>(args.Length);
            for (int i = 0; i < args.Length; i++) {
                if (string.Equals(args[i], "--bundle-verify", StringComparison.OrdinalIgnoreCase)) {
                    verifyOnly = true;
                } else if (string.Equals(args[i], "--bundle-extract-only", StringComparison.OrdinalIgnoreCase)) {
                    extractOnly = true;
                } else if (string.Equals(args[i], "--bundle-file", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) {
                    explicitBundleFile = Path.GetFullPath(args[++i]);
                } else {
                    forwardArgs.Add(args[i]);
                }
            }
            headless = verifyOnly || extractOnly;

            string exePath = explicitBundleFile
                ?? Environment.ProcessPath
                ?? Process.GetCurrentProcess().MainModule?.FileName
                ?? throw new InvalidOperationException("Cannot locate executable path.");

            if (!TryReadFooter(exePath, out var footer)) {
                ReportError("Station Designer bundle footer is missing or corrupted.\nRebuild with: npm run build:unity:windows", headless);
                return 2;
            }

            if (verifyOnly) {
                return VerifyBundle(exePath, footer);
            }

            string cacheRoot = ResolveWritableCacheRoot(exePath);
            string targetDir = Path.Combine(cacheRoot, footer.BundleId);
            EnsureExtracted(exePath, footer, cacheRoot, targetDir, showProgress: !extractOnly);

            if (extractOnly) {
                Console.WriteLine(targetDir);
                return 0;
            }

            if (!HasWebView2Runtime()) {
                ReportError(
                    "Microsoft Edge WebView2 Runtime is required for the Station Designer UI.\n\n" +
                    "Please install the Microsoft Edge WebView2 Evergreen Runtime from Microsoft and relaunch StationDesigner.exe.",
                    headless: false);
                return 3;
            }

            string playerExe = Path.Combine(targetDir, PlayerExeName);
            if (!File.Exists(playerExe)) {
                ReportError($"Extracted player executable is missing:\n{playerExe}", headless: false);
                return 4;
            }

            var psi = new ProcessStartInfo {
                FileName = playerExe,
                WorkingDirectory = targetDir,
                UseShellExecute = false,
            };
            bool hasFullscreenFlag = forwardArgs.Any(a => string.Equals(a, "-screen-fullscreen", StringComparison.OrdinalIgnoreCase));
            bool hasWidthFlag = forwardArgs.Any(a => string.Equals(a, "-screen-width", StringComparison.OrdinalIgnoreCase));
            bool hasHeightFlag = forwardArgs.Any(a => string.Equals(a, "-screen-height", StringComparison.OrdinalIgnoreCase));
            if (!hasFullscreenFlag) {
                psi.ArgumentList.Add("-screen-fullscreen");
                psi.ArgumentList.Add("0");
            }
            if (!hasWidthFlag) {
                psi.ArgumentList.Add("-screen-width");
                psi.ArgumentList.Add("1600");
            }
            if (!hasHeightFlag) {
                psi.ArgumentList.Add("-screen-height");
                psi.ArgumentList.Add("900");
            }
            foreach (string arg in forwardArgs) {
                psi.ArgumentList.Add(arg);
            }

            using var proc = Process.Start(psi) ?? throw new InvalidOperationException("Failed to start MetroStation.exe.");
            proc.WaitForExit();
            return proc.ExitCode;
        } catch (Exception ex) {
            ReportError("Station Designer could not start:\n\n" + ex.Message, headless);
            return 1;
        }
    }

    private static string ResolveWritableCacheRoot(string exePath) {
        string? explicitDir = Environment.GetEnvironmentVariable("METRO_BUNDLE_CACHE_DIR");
        if (!string.IsNullOrWhiteSpace(explicitDir)) {
            Directory.CreateDirectory(explicitDir);
            return explicitDir;
        }

        var candidates = new List<string> {
            Path.Combine(Path.GetTempPath(), "StationDesigner", "runtime"),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "StationDesigner",
                "runtime"),
        };
        string? exeDir = Path.GetDirectoryName(exePath);
        if (!string.IsNullOrWhiteSpace(exeDir)) {
            candidates.Add(Path.Combine(exeDir, ".station-designer-runtime"));
        }

        Exception? lastError = null;
        foreach (string dir in candidates) {
            try {
                Directory.CreateDirectory(dir);
                string probe = Path.Combine(dir, $".write-probe-{Environment.ProcessId}");
                File.WriteAllText(probe, "ok");
                File.Delete(probe);
                return dir;
            } catch (Exception ex) {
                lastError = ex;
            }
        }
        throw lastError ?? new UnauthorizedAccessException("No writable cache directory found for Station Designer.");
    }

    private readonly record struct BundleFooter(long PayloadOffset, long PayloadLength, string BundleId);

    private static bool TryReadFooter(string exePath, out BundleFooter footer) {
        footer = default;
        using var fs = new FileStream(exePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        if (fs.Length < FooterBytes) return false;
        fs.Seek(-FooterBytes, SeekOrigin.End);
        Span<byte> buf = stackalloc byte[FooterBytes];
        fs.ReadExactly(buf);
        if (!buf[..16].SequenceEqual(FooterMagic)) return false;

        long offset = BitConverter.ToInt64(buf.Slice(16, 8));
        long length = BitConverter.ToInt64(buf.Slice(24, 8));
        string bundleId = Convert.ToHexString(buf.Slice(32, 16)).ToLowerInvariant();
        long version = BitConverter.ToInt64(buf.Slice(48, 8));
        if (version != 1 || offset <= 0 || length <= 0 || offset + length + FooterBytes != fs.Length) {
            return false;
        }
        footer = new BundleFooter(offset, length, bundleId);
        return true;
    }

    private static int VerifyBundle(string exePath, BundleFooter footer) {
        using var fs = new FileStream(exePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        using var slice = new ReadOnlySliceStream(fs, footer.PayloadOffset, footer.PayloadLength);
        using var zip = new ZipArchive(slice, ZipArchiveMode.Read, leaveOpen: true);

        bool hasPlayer = false;
        bool hasUnityDll = false;
        bool hasWebView = false;
        bool hasUiManifest = false;
        long totalUncompressed = 0;
        int fileCount = 0;

        foreach (var entry in zip.Entries) {
            if (string.IsNullOrEmpty(entry.Name)) continue;
            fileCount++;
            totalUncompressed += entry.Length;
            string norm = entry.FullName.Replace('\\', '/');
            if (norm.Equals("MetroStation.exe", StringComparison.OrdinalIgnoreCase)) hasPlayer = true;
            else if (norm.Equals("UnityPlayer.dll", StringComparison.OrdinalIgnoreCase)) hasUnityDll = true;
            else if (norm.Equals("MetroStation_Data/StreamingAssets/MetroUi/bin/MetroEditorWebView.exe", StringComparison.OrdinalIgnoreCase)) hasWebView = true;
            else if (norm.Equals("MetroStation_Data/StreamingAssets/MetroUi/ui/.vite/manifest.json", StringComparison.OrdinalIgnoreCase)) hasUiManifest = true;
        }

        bool ok = hasPlayer && hasUnityDll && hasWebView && hasUiManifest;
        string summary =
            $"{{\"ok\":{(ok ? "true" : "false")},\"bundleId\":\"{footer.BundleId}\",\"payloadBytes\":{footer.PayloadLength}," +
            $"\"uncompressedBytes\":{totalUncompressed},\"files\":{fileCount}," +
            $"\"hasPlayer\":{(hasPlayer ? "true" : "false")},\"hasUnityPlayerDll\":{(hasUnityDll ? "true" : "false")}," +
            $"\"hasWebView\":{(hasWebView ? "true" : "false")},\"hasUiManifest\":{(hasUiManifest ? "true" : "false")}}}";
        Console.WriteLine(summary);
        return ok ? 0 : 5;
    }

    private static bool IsReady(string targetDir, string bundleId) {
        string marker = Path.Combine(targetDir, ReadyMarkerName);
        if (!File.Exists(marker)) return false;
        if (!File.Exists(Path.Combine(targetDir, PlayerExeName))) return false;
        if (!File.Exists(Path.Combine(targetDir, "UnityPlayer.dll"))) return false;
        try {
            return string.Equals(File.ReadAllText(marker).Trim(), bundleId, StringComparison.OrdinalIgnoreCase);
        } catch {
            return false;
        }
    }

    private static void EnsureExtracted(string exePath, BundleFooter footer, string cacheRoot, string targetDir, bool showProgress) {
        if (IsReady(targetDir, footer.BundleId)) return;

        using var mutex = new Mutex(false, $"Local\\MetroStationDesignerExtract_{footer.BundleId}");
        bool acquired = false;
        try {
            try {
                acquired = mutex.WaitOne(TimeSpan.FromMinutes(5));
            } catch (AbandonedMutexException) {
                acquired = true;
            }
            if (!acquired) throw new TimeoutException("Timed out waiting for another instance to finish extracting.");
            if (IsReady(targetDir, footer.BundleId)) return;

            // Extract directly into targetDir while holding the per-bundle mutex, writing
            // ReadyMarkerName last. Renaming a directory immediately after writing 700+
            // .exe/.dll files frequently hits transient Windows Defender locks on Directory.Move.
            Directory.CreateDirectory(targetDir);
            string markerPath = Path.Combine(targetDir, ReadyMarkerName);
            if (File.Exists(markerPath)) File.Delete(markerPath);

            using var progress = showProgress ? new NativeProgressWindow("Station Designer") : null;
            using var fs = new FileStream(exePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var slice = new ReadOnlySliceStream(fs, footer.PayloadOffset, footer.PayloadLength);
            using var zip = new ZipArchive(slice, ZipArchiveMode.Read, leaveOpen: true);

            long totalBytes = 0;
            foreach (var entry in zip.Entries) totalBytes += Math.Max(0, entry.Length);
            long extractedBytes = 0;
            string fullTarget = Path.GetFullPath(targetDir);
            if (!fullTarget.EndsWith(Path.DirectorySeparatorChar)) fullTarget += Path.DirectorySeparatorChar;

            byte[] copyBuf = new byte[256 * 1024];
            int lastPercent = -1;
            foreach (var entry in zip.Entries) {
                string rel = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                string destPath = Path.GetFullPath(Path.Combine(fullTarget, rel));
                if (!destPath.StartsWith(fullTarget, StringComparison.OrdinalIgnoreCase)) {
                    throw new InvalidOperationException($"Unsafe archive path: {entry.FullName}");
                }
                if (string.IsNullOrEmpty(entry.Name)) {
                    Directory.CreateDirectory(destPath);
                    continue;
                }
                Directory.CreateDirectory(Path.GetDirectoryName(destPath)!);
                using var entryStream = entry.Open();
                using var outStream = new FileStream(destPath, FileMode.Create, FileAccess.Write, FileShare.None, 256 * 1024);
                int read;
                while ((read = entryStream.Read(copyBuf, 0, copyBuf.Length)) > 0) {
                    outStream.Write(copyBuf, 0, read);
                    extractedBytes += read;
                    if (progress != null && totalBytes > 0) {
                        int pct = (int)Math.Clamp(extractedBytes * 100L / totalBytes, 0, 100);
                        if (pct != lastPercent) {
                            lastPercent = pct;
                            progress.SetProgress(pct);
                        }
                    }
                }
            }

            File.WriteAllText(markerPath, footer.BundleId);
            PruneOlderBundles(cacheRoot, footer.BundleId);
        } finally {
            if (acquired) {
                try { mutex.ReleaseMutex(); } catch { }
            }
        }
    }

    private static void PruneOlderBundles(string cacheRoot, string keepId) {
        try {
            foreach (string dir in Directory.GetDirectories(cacheRoot)) {
                string name = Path.GetFileName(dir);
                if (string.Equals(name, keepId, StringComparison.OrdinalIgnoreCase)) continue;
                try { Directory.Delete(dir, recursive: true); } catch { /* locked by another running instance */ }
            }
        } catch { }
    }

    private static bool HasWebView2Runtime() {
        const string clientGuid = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
        string[] subKeys = [
            $@"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{clientGuid}",
            $@"SOFTWARE\Microsoft\EdgeUpdate\Clients\{clientGuid}",
        ];
        foreach (string subKey in subKeys) {
            using var hklm = Registry.LocalMachine.OpenSubKey(subKey);
            if (!string.IsNullOrWhiteSpace(hklm?.GetValue("pv") as string)) return true;
            using var hkcu = Registry.CurrentUser.OpenSubKey(subKey);
            if (!string.IsNullOrWhiteSpace(hkcu?.GetValue("pv") as string)) return true;
        }
        return false;
    }

    private static void ReportError(string message, bool headless) {
        if (headless) {
            Console.Error.WriteLine(message);
            return;
        }
        MessageBoxW(IntPtr.Zero, message, "Station Designer", 0x00000010u /* MB_ICONERROR */);
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

    private sealed class ReadOnlySliceStream : Stream {
        private readonly Stream inner;
        private readonly long start;
        private readonly long length;
        private long position;

        public ReadOnlySliceStream(Stream inner, long start, long length) {
            this.inner = inner;
            this.start = start;
            this.length = length;
            this.inner.Seek(start, SeekOrigin.Begin);
        }

        public override bool CanRead => true;
        public override bool CanSeek => true;
        public override bool CanWrite => false;
        public override long Length => length;
        public override long Position {
            get => position;
            set => Seek(value, SeekOrigin.Begin);
        }

        public override int Read(byte[] buffer, int offset, int count) {
            long remaining = length - position;
            if (remaining <= 0) return 0;
            int toRead = (int)Math.Min(count, remaining);
            inner.Position = start + position;
            int n = inner.Read(buffer, offset, toRead);
            position += n;
            return n;
        }

        public override long Seek(long offset, SeekOrigin origin) {
            long next = origin switch {
                SeekOrigin.Begin => offset,
                SeekOrigin.Current => position + offset,
                SeekOrigin.End => length + offset,
                _ => throw new ArgumentOutOfRangeException(nameof(origin)),
            };
            if (next < 0 || next > length) throw new IOException("Seek out of bounds.");
            position = next;
            inner.Position = start + position;
            return position;
        }

        public override void Flush() { }
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    /// <summary>
    /// Minimal native Win32 progress window shown only during first-run extraction (zero WinForms overhead).
    /// </summary>
    private sealed class NativeProgressWindow : IDisposable {
        private const int WmClose = 0x0010;
        private const int PbmSetPos = 0x0402;
        private const int PbmSetRange32 = 0x0406;
        private readonly Thread uiThread;
        private readonly ManualResetEventSlim ready = new(false);
        private IntPtr hwnd;
        private IntPtr progressHwnd;
        private IntPtr labelHwnd;
        private volatile bool closed;

        public NativeProgressWindow(string title) {
            uiThread = new Thread(() => RunLoop(title)) { IsBackground = true };
            uiThread.SetApartmentState(ApartmentState.STA);
            uiThread.Start();
            ready.Wait(1500);
        }

        public void SetProgress(int percent) {
            if (closed || progressHwnd == IntPtr.Zero) return;
            PostMessageW(progressHwnd, PbmSetPos, (IntPtr)percent, IntPtr.Zero);
            if (labelHwnd != IntPtr.Zero) {
                SetWindowTextW(labelHwnd, $"Preparing Station Designer… {percent}%");
            }
        }

        public void Dispose() {
            if (closed) return;
            closed = true;
            if (hwnd != IntPtr.Zero) {
                PostMessageW(hwnd, WmClose, IntPtr.Zero, IntPtr.Zero);
            }
            try { uiThread.Join(1000); } catch { }
            ready.Dispose();
        }

        private void RunLoop(string title) {
            try {
                var icc = new InitCommonControlsExStruct { dwSize = Marshal.SizeOf<InitCommonControlsExStruct>(), dwICC = 0x00000020 /* ICC_PROGRESS_CLASS */ };
                InitCommonControlsEx(ref icc);

                const int width = 380;
                const int height = 112;
                int screenW = GetSystemMetrics(0);
                int screenH = GetSystemMetrics(1);
                int x = Math.Max(0, (screenW - width) / 2);
                int y = Math.Max(0, (screenH - height) / 2);

                const uint style = 0x10C80000u; // WS_VISIBLE | WS_CAPTION | WS_POPUP
                const uint exStyle = 0x00000008u; // WS_EX_TOPMOST
                hwnd = CreateWindowExW(exStyle, "#32770", title, style, x, y, width, height, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
                if (hwnd == IntPtr.Zero) { ready.Set(); return; }

                labelHwnd = CreateWindowExW(0, "STATIC", "Preparing Station Designer… 0%", 0x50000000u /* WS_CHILD | WS_VISIBLE */, 18, 16, 336, 20, hwnd, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
                progressHwnd = CreateWindowExW(0, "msctls_progress32", "", 0x50000000u, 18, 44, 336, 20, hwnd, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
                IntPtr font = GetStockObject(17 /* DEFAULT_GUI_FONT */);
                if (font != IntPtr.Zero && labelHwnd != IntPtr.Zero) {
                    SendMessageW(labelHwnd, 0x0030 /* WM_SETFONT */, font, (IntPtr)1);
                }
                if (progressHwnd != IntPtr.Zero) {
                    SendMessageW(progressHwnd, PbmSetRange32, IntPtr.Zero, (IntPtr)100);
                }
                ready.Set();

                while (!closed && GetMessageW(out var msg, IntPtr.Zero, 0, 0) > 0) {
                    if (msg.message == WmClose && msg.hwnd == hwnd) break;
                    TranslateMessage(ref msg);
                    DispatchMessageW(ref msg);
                }
                if (hwnd != IntPtr.Zero) DestroyWindow(hwnd);
            } catch {
                ready.Set();
            }
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct InitCommonControlsExStruct { public int dwSize; public int dwICC; }

        [StructLayout(LayoutKind.Sequential)]
        private struct Msg { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int ptX; public int ptY; }

        [DllImport("comctl32.dll")]
        private static extern bool InitCommonControlsEx(ref InitCommonControlsExStruct icc);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateWindowExW(uint exStyle, string className, string windowName, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
        [DllImport("user32.dll")]
        private static extern bool DestroyWindow(IntPtr hWnd);
        [DllImport("user32.dll")]
        private static extern int GetSystemMetrics(int nIndex);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern bool PostMessageW(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr SendMessageW(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern bool SetWindowTextW(IntPtr hWnd, string text);
        [DllImport("user32.dll")]
        private static extern int GetMessageW(out Msg lpMsg, IntPtr hWnd, uint min, uint max);
        [DllImport("user32.dll")]
        private static extern bool TranslateMessage(ref Msg lpMsg);
        [DllImport("user32.dll")]
        private static extern IntPtr DispatchMessageW(ref Msg lpMsg);
        [DllImport("gdi32.dll")]
        private static extern IntPtr GetStockObject(int fnObject);
    }
}
