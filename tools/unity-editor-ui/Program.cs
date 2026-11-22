using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.IO.MemoryMappedFiles;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace Metro.EditorWebView;

internal static class Program {
    [STAThread]
    public static int Main(string[] args) {
        var options = CliOptions.Parse(args);
        Environment.SetEnvironmentVariable("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "0");
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => LogFatal(options, "UI thread exception: " + e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => LogFatal(options, "Unhandled exception: " + e.ExceptionObject);
        try {
            Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var syncContext = new WindowsFormsSynchronizationContext();
            SynchronizationContext.SetSynchronizationContext(syncContext);

            using var appContext = new ApplicationContext();
            using var host = new OffscreenWebViewHost(options, syncContext, appContext);
            host.Start();
            Application.Run(appContext);

            if (options.SelfTest && Directory.Exists(options.UserDataDir)) {
                try { Directory.Delete(options.UserDataDir, recursive: true); } catch { }
            }
            return host.ExitCode;
        } catch (Exception ex) {
            LogFatal(options, ex.ToString());
            return 1;
        }
    }

    public static void LogFatal(CliOptions options, string text) {
        try { Console.Error.WriteLine(text); } catch { }
        try {
            string logDir = !string.IsNullOrWhiteSpace(options.LogDir)
                ? options.LogDir
                : Path.Combine(options.RepoRoot, ".preview", "unity", "editor-ui-host");
            Directory.CreateDirectory(logDir);
            File.WriteAllText(Path.Combine(logDir, "last-error.log"), DateTime.UtcNow.ToString("o") + "\n" + text);
        } catch { }
    }
}

internal sealed class CliOptions {
    public int Port { get; init; }
    public int UnityPid { get; init; }
    public string ShmName { get; init; } = "";
    public int InitialWidth { get; init; } = 1280;
    public int InitialHeight { get; init; } = 720;
    public string RepoRoot { get; init; } = "";
    public string UiDir { get; init; } = "";
    public string PublicDir { get; init; } = "";
    public string LogDir { get; init; } = "";
    public string InitialRoute { get; init; } = "/game/";
    public string UserDataDir { get; init; } = "";
    public bool SelfTest { get; init; }
    public string SelfTestOut { get; init; } = "";

    public static CliOptions Parse(string[] args) {
        int port = 0;
        int unityPid = 0;
        string shmName = "";
        int width = 1280;
        int height = 720;
        string repo = Directory.GetCurrentDirectory();
        string uiDir = "";
        string publicDir = "";
        string logDir = "";
        string route = "/game/";
        string userData = "";
        bool selfTest = false;
        string selfTestOut = "";

        for (int i = 0; i < args.Length; i++) {
            switch (args[i]) {
                case "--port" when i + 1 < args.Length:
                    int.TryParse(args[++i], out port);
                    break;
                case "--unity-pid" when i + 1 < args.Length:
                    int.TryParse(args[++i], out unityPid);
                    break;
                case "--shm" when i + 1 < args.Length:
                    shmName = args[++i];
                    break;
                case "--width" when i + 1 < args.Length:
                    int.TryParse(args[++i], out width);
                    break;
                case "--height" when i + 1 < args.Length:
                    int.TryParse(args[++i], out height);
                    break;
                case "--repo" when i + 1 < args.Length:
                    repo = Path.GetFullPath(args[++i]);
                    break;
                case "--ui-dir" when i + 1 < args.Length:
                    uiDir = Path.GetFullPath(args[++i]);
                    break;
                case "--public-dir" when i + 1 < args.Length:
                    publicDir = Path.GetFullPath(args[++i]);
                    break;
                case "--log-dir" when i + 1 < args.Length:
                    logDir = Path.GetFullPath(args[++i]);
                    break;
                case "--route" when i + 1 < args.Length:
                    route = args[++i];
                    break;
                case "--user-data" when i + 1 < args.Length:
                    userData = Path.GetFullPath(args[++i]);
                    break;
                case "--owner-hwnd" when i + 1 < args.Length:
                    // Accepted as no-op for backward CLI compatibility; offscreen mode never parents/floats over HWNDs.
                    i++;
                    break;
                case "--self-test":
                    selfTest = true;
                    break;
                case "--self-test-out" when i + 1 < args.Length:
                    selfTestOut = Path.GetFullPath(args[++i]);
                    break;
            }
        }

        if (!route.StartsWith('/')) route = "/" + route;
        if (string.IsNullOrWhiteSpace(uiDir)) uiDir = Path.Combine(repo, "game", "dist-unity-ui");
        if (string.IsNullOrWhiteSpace(publicDir)) publicDir = Path.Combine(repo, "game", "public");
        if (string.IsNullOrWhiteSpace(userData)) {
            string baseTemp = !string.IsNullOrWhiteSpace(logDir)
                ? logDir
                : Path.Combine(repo, ".preview", "unity", "editor-ui-host");
            userData = Path.Combine(baseTemp, selfTest ? "webview2-selftest-" + Environment.ProcessId : "webview2-profile");
        }
        if (string.IsNullOrWhiteSpace(shmName) && selfTest) {
            shmName = Path.Combine(userData, "selftest-shm.bin");
        }

        return new CliOptions {
            Port = port,
            UnityPid = unityPid,
            ShmName = shmName,
            InitialWidth = Math.Clamp(width, 64, SharedFrameBuffer.MaxWidth),
            InitialHeight = Math.Clamp(height, 64, SharedFrameBuffer.MaxHeight),
            RepoRoot = repo,
            UiDir = uiDir,
            PublicDir = publicDir,
            LogDir = logDir,
            InitialRoute = route,
            UserDataDir = userData,
            SelfTest = selfTest,
            SelfTestOut = selfTestOut,
        };
    }
}

/// <summary>
/// Lock-free double-buffered BGRA32 shared memory region read directly by Unity's
/// <c>Texture2D.LoadRawTextureData(IntPtr, int)</c>, backed by GPU
/// <c>Windows.Graphics.Capture</c> (<c>Direct3D11CaptureFramePool.CreateFreeThreaded</c>)
/// so full per-pixel 8-bit alpha is preserved with zero GDI black-background compositing.
/// </summary>
internal sealed unsafe class SharedFrameBuffer : IDisposable {
    public const int Magic = 0x4D554932; // "MUI2"
    public const int HeaderBytes = 64;
    public const int MaxWidth = 3840;
    public const int MaxHeight = 2160;
    public const int SlotStrideBytes = MaxWidth * MaxHeight * 4;
    public const long TotalBytes = HeaderBytes + 2L * SlotStrideBytes;

    private static readonly uint[] UnpremulRecip = BuildRecipTable();

    private readonly FileStream fileStream;
    private readonly MemoryMappedFile mmf;
    private readonly MemoryMappedViewAccessor accessor;
    private readonly string backingFilePath;
    private readonly bool ownsBackingFile;
    private byte* basePtr;
    private int currentActiveSlot;
    private long sequence;
    private bool disposed;

    private D3d11VisualCapture? wgc;

    public SharedFrameBuffer(string mapPathOrName) {
        if (Path.IsPathRooted(mapPathOrName)) {
            backingFilePath = mapPathOrName;
            ownsBackingFile = false;
        } else {
            backingFilePath = Path.Combine(Path.GetTempPath(), mapPathOrName + ".bin");
            ownsBackingFile = true;
        }
        Directory.CreateDirectory(Path.GetDirectoryName(backingFilePath)!);
        fileStream = new FileStream(backingFilePath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.ReadWrite | FileShare.Delete);
        if (fileStream.Length < TotalBytes) {
            fileStream.SetLength(TotalBytes);
        }
        mmf = MemoryMappedFile.CreateFromFile(fileStream, null, TotalBytes, MemoryMappedFileAccess.ReadWrite, HandleInheritability.None, leaveOpen: true);
        accessor = mmf.CreateViewAccessor(0, TotalBytes, MemoryMappedFileAccess.ReadWrite);
        accessor.SafeMemoryMappedViewHandle.AcquirePointer(ref basePtr);

        *(int*)(basePtr + 0) = Magic;
        *(int*)(basePtr + 4) = 0;
        *(long*)(basePtr + 8) = 0L;
    }

    public long Sequence => Interlocked.Read(ref sequence);

    private static uint[] BuildRecipTable() {
        var table = new uint[256];
        for (uint a = 1; a < 256; a++) {
            table[a] = ((255u << 16) + (a >> 1)) / a;
        }
        return table;
    }

    public void InitializeCompositionVisual(IntPtr hostHwnd, int width, int height) {
        if (disposed) return;
        wgc?.Dispose();
        wgc = new D3d11VisualCapture(
            hostHwnd,
            Math.Clamp(width, 64, MaxWidth),
            Math.Clamp(height, 64, MaxHeight));
    }

    public void AttachWebViewCompositionController(CoreWebView2CompositionController compController) {
        if (disposed || wgc == null) return;
        wgc.AttachWebViewController(compController);
    }

    public void NotifyResize(int width, int height) {
        if (disposed) return;
        wgc?.Resize(Math.Clamp(width, 64, MaxWidth), Math.Clamp(height, 64, MaxHeight));
    }

    public bool CaptureWindowFrame(IntPtr hwnd, int width, int height, double rasterScale) {
        if (disposed || basePtr == null || wgc == null) return false;
        int w = Math.Clamp(width, 64, MaxWidth);
        int h = Math.Clamp(height, 64, MaxHeight);

        if (!wgc.TryAcquireLatestStagingFrame(w, h, out int frameW, out int frameH)) {
            return false;
        }

        return WriteLastStagingToSlot(frameW, frameH, rasterScale);
    }

    public bool BenchmarkRemapStagingFrame(double rasterScale) {
        if (disposed || basePtr == null || wgc == null || wgc.StagingWidth <= 0 || wgc.StagingHeight <= 0) {
            return false;
        }
        return WriteLastStagingToSlot(wgc.StagingWidth, wgc.StagingHeight, rasterScale);
    }

    private bool WriteLastStagingToSlot(int frameW, int frameH, double rasterScale) {
        if (wgc == null || !wgc.TryMapStaging(out IntPtr pData, out uint rowPitch)) {
            return false;
        }
        try {
            int copyW = Math.Clamp(frameW, 1, MaxWidth);
            int copyH = Math.Clamp(frameH, 1, MaxHeight);
            int byteLen = copyW * copyH * 4;

            int nextSlot = 1 - currentActiveSlot;
            byte* dstSlot = basePtr + HeaderBytes + (long)nextSlot * SlotStrideBytes;

            byte* srcBase = (byte*)pData;
            uint* dstRow = (uint*)dstSlot;
            for (int y = 0; y < copyH; y++) {
                uint* srcRow = (uint*)(srcBase + (long)y * rowPitch);
                for (int x = 0; x < copyW; x++) {
                    uint px = srcRow[x];
                    uint a = px >> 24;
                    if (a == 255u) {
                        dstRow[x] = px;
                    } else if (a == 0u) {
                        dstRow[x] = 0u;
                    } else {
                        // Convert DComp premultiplied sRGB BGRA into straight sRGB BGRA so Unity's
                        // standard sRGB Texture2D + UI/Default shader composites without dark fringes.
                        uint recip = UnpremulRecip[a];
                        uint b = Math.Min(255u, (((px & 0xFFu) * recip) + 32768u) >> 16);
                        uint g = Math.Min(255u, ((((px >> 8) & 0xFFu) * recip) + 32768u) >> 16);
                        uint r = Math.Min(255u, ((((px >> 16) & 0xFFu) * recip) + 32768u) >> 16);
                        dstRow[x] = (a << 24) | (r << 16) | (g << 8) | b;
                    }
                }
                dstRow += copyW;
            }

            int metaOffset = nextSlot == 0 ? 16 : 32;
            *(int*)(basePtr + metaOffset + 0) = copyW;
            *(int*)(basePtr + metaOffset + 4) = copyH;
            *(int*)(basePtr + metaOffset + 8) = byteLen;
            *(int*)(basePtr + metaOffset + 12) = (int)Math.Round(rasterScale * 1000.0);

            Thread.MemoryBarrier();
            Volatile.Write(ref *(int*)(basePtr + 4), nextSlot);
            currentActiveSlot = nextSlot;
            long nextSeq = Interlocked.Increment(ref sequence);
            Volatile.Write(ref *(long*)(basePtr + 8), nextSeq);
            return true;
        } finally {
            wgc.UnmapStaging();
        }
    }

    public int[] SamplePixelRgba(int x, int y) {
        if (disposed || basePtr == null || Sequence <= 0) return new[] { 0, 0, 0, 0 };
        int slot = Volatile.Read(ref *(int*)(basePtr + 4));
        int metaOffset = slot == 0 ? 16 : 32;
        int w = *(int*)(basePtr + metaOffset + 0);
        int h = *(int*)(basePtr + metaOffset + 4);
        if (w <= 0 || h <= 0) return new[] { 0, 0, 0, 0 };
        int cx = Math.Clamp(x, 0, w - 1);
        int cy = Math.Clamp(y, 0, h - 1);
        byte* p = basePtr + HeaderBytes + (long)slot * SlotStrideBytes + ((long)cy * w + cx) * 4;
        return new[] { (int)p[2], p[1], p[0], p[3] };
    }

    public void SaveActiveSlotPng(string path) {
        if (disposed || basePtr == null) throw new ObjectDisposedException(nameof(SharedFrameBuffer));
        int slot = Volatile.Read(ref *(int*)(basePtr + 4));
        int metaOffset = slot == 0 ? 16 : 32;
        int w = *(int*)(basePtr + metaOffset + 0);
        int h = *(int*)(basePtr + metaOffset + 4);
        if (w <= 0 || h <= 0) throw new InvalidOperationException("No frame captured yet.");

        byte* srcSlot = basePtr + HeaderBytes + (long)slot * SlotStrideBytes;
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        using var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        try {
            int rowBytes = w * 4;
            for (int y = 0; y < h; y++) {
                Buffer.MemoryCopy(srcSlot + (long)y * rowBytes, (byte*)data.Scan0 + (long)y * data.Stride, data.Stride, rowBytes);
            }
        } finally {
            bmp.UnlockBits(data);
        }
        bmp.Save(path, ImageFormat.Png);
    }

    public void Dispose() {
        if (disposed) return;
        disposed = true;
        wgc?.Dispose();
        wgc = null;
        if (basePtr != null) {
            accessor.SafeMemoryMappedViewHandle.ReleasePointer();
            basePtr = null;
        }
        accessor.Dispose();
        mmf.Dispose();
        fileStream.Dispose();
        if (ownsBackingFile) {
            try { if (File.Exists(backingFilePath)) File.Delete(backingFilePath); } catch { }
        }
    }
}

/// <summary>
/// Zero-dependency COM/WinRT <c>Windows.UI.Composition</c> + <c>Windows.Graphics.Capture</c>
/// (<c>GraphicsCaptureItem.CreateFromVisual</c>) + D3D11 staging reader.
/// Captures <see cref="CoreWebView2CompositionController"/> directly offscreen in
/// <c>DXGI_FORMAT_B8G8R8A8_UNORM</c> (format 87) with full 8-bit alpha and no monitor size clamp.
/// </summary>
internal sealed unsafe class D3d11VisualCapture : IDisposable {
    private const int DxgiFormatB8G8R8A8Unorm = 87;
    private const uint D3d11CreateDeviceBgraSupport = 0x20u;
    private const uint D3d11SdkVersion = 7u;
    private const uint D3d11UsageStaging = 3u;
    private const uint D3d11CpuAccessRead = 0x20000u;
    private const uint D3d11MapRead = 1u;

    private static readonly Guid IidIdxgiDevice = new("54ec77fa-1377-44e6-8c32-88fd5f44c84c");
    private static readonly Guid IidIDirect3DDevice = new("a37624ab-8d5f-4650-9d3e-9eae3d9bc670");
    private static readonly Guid IidICompositor = new("b403ca50-7f8c-4e83-985f-cc45060036d8");
    private static readonly Guid IidICompositorDesktopInterop = new("29e691fa-4567-4dca-b319-d0f207eb6807");
    private static readonly Guid IidICompositionTarget = new("a1bea8ba-d726-4663-8129-6b5e7927ffa6");
    private static readonly Guid IidIContainerVisual = new("02f6bc74-ed20-4773-afe6-d49b4a93db32");
    private static readonly Guid IidIVisual = new("117e202d-a859-4c89-873b-c2aa566788e3");
    private static readonly Guid IidIVisualCollection = new("8b745505-fd3e-4a98-84a8-e949468c6bcb");
    private static readonly Guid IidICoreWebView2CompositionController = new("3df9b733-b9ae-4a15-86b4-eb9ee9826469");
    private static readonly Guid IidIGraphicsCaptureItemStatics = new("a87ebea5-457c-5788-ab47-0cf1d3637e74");
    private static readonly Guid IidIDirect3D11CaptureFramePoolStatics2 = new("589b103f-6bbc-5df5-a991-02e28b3b66d5");
    private static readonly Guid IidIGraphicsCaptureSession2 = new("2c39ae40-7d2e-5044-804e-8b6799d4cf9e");
    private static readonly Guid IidIGraphicsCaptureSession3 = new("f2cdd966-22ae-5ea1-9596-3a289344c3be");
    private static readonly Guid IidIDirect3DDxgiInterfaceAccess = new("a9b3d012-3df2-4ee3-b8d1-8695f457d3c1");
    private static readonly Guid IidID3D11Texture2D = new("6f15aaf2-d208-4e89-9ab4-489535d34f9c");
    private static readonly Guid IidIClosable = new("30d5a829-7fa4-4026-83bb-d75bae4ea99e");

    private IntPtr dqController;
    private IntPtr compositor;
    private IntPtr desktopTarget;
    private IntPtr windowRootContainer;
    private IntPtr windowRootVisual;
    private IntPtr webViewContainer;
    private IntPtr webViewVisual;

    private IntPtr d3dDevice;
    private IntPtr d3dContext;
    private IntPtr winrtDevice;
    private IntPtr captureItem;
    private IntPtr framePool;
    private IntPtr captureSession;
    private IntPtr stagingTex;
    private int poolWidth;
    private int poolHeight;
    private int stagingWidth;
    private int stagingHeight;
    private int lastContentWidth;
    private int lastContentHeight;
    private bool disposed;

    public int StagingWidth => lastContentWidth > 0 ? Math.Min(lastContentWidth, stagingWidth) : stagingWidth;
    public int StagingHeight => lastContentHeight > 0 ? Math.Min(lastContentHeight, stagingHeight) : stagingHeight;

    public D3d11VisualCapture(IntPtr hostHwnd, int initialWidth, int initialHeight) {
        poolWidth = Math.Max(64, initialWidth);
        poolHeight = Math.Max(64, initialHeight);

        var dqOptions = new NativeMethods.DispatcherQueueOptions {
            dwSize = sizeof(NativeMethods.DispatcherQueueOptions),
            threadType = 2,    // DQTYPE_THREAD_CURRENT
            apartmentType = 2, // DQTAT_COM_STA
        };
        CheckHr(NativeMethods.CreateDispatcherQueueController(dqOptions, out dqController), "CreateDispatcherQueueController");

        IntPtr compInspectable = ActivateInstance("Windows.UI.Composition.Compositor");
        try {
            compositor = QueryInterface(compInspectable, IidICompositor, "QI ICompositor");
        } finally {
            ReleaseCom(ref compInspectable);
        }

        IntPtr desktopInterop = QueryInterface(compositor, IidICompositorDesktopInterop, "QI ICompositorDesktopInterop");
        try {
            IntPtr target = IntPtr.Zero;
            var createDesktopTarget = (delegate* unmanaged[Stdcall]<IntPtr, IntPtr, int, IntPtr*, int>)(*(void***)desktopInterop)[3];
            CheckHr(createDesktopTarget(desktopInterop, hostHwnd, 0 /* isTopmost = false */, &target), "CreateDesktopWindowTarget");
            desktopTarget = target;
        } finally {
            ReleaseCom(ref desktopInterop);
        }

        var createContainerVisual = (delegate* unmanaged[Stdcall]<IntPtr, IntPtr*, int>)(*(void***)compositor)[9];
        IntPtr rootContainer = IntPtr.Zero;
        CheckHr(createContainerVisual(compositor, &rootContainer), "CreateContainerVisual(root)");
        windowRootContainer = rootContainer;
        windowRootVisual = QueryInterface(windowRootContainer, IidIVisual, "QI IVisual(root)");

        IntPtr compTarget = QueryInterface(desktopTarget, IidICompositionTarget, "QI ICompositionTarget");
        try {
            var putRoot = (delegate* unmanaged[Stdcall]<IntPtr, IntPtr, int>)(*(void***)compTarget)[7];
            CheckHr(putRoot(compTarget, windowRootVisual), "ICompositionTarget.put_Root");
        } finally {
            ReleaseCom(ref compTarget);
        }

        IntPtr wvContainer = IntPtr.Zero;
        CheckHr(createContainerVisual(compositor, &wvContainer), "CreateContainerVisual(webview)");
        webViewContainer = wvContainer;
        webViewVisual = QueryInterface(webViewContainer, IidIVisual, "QI IVisual(webview)");
        SetVisualSize(webViewVisual, poolWidth, poolHeight);

        IntPtr rootContainerIface = QueryInterface(windowRootContainer, IidIContainerVisual, "QI IContainerVisual(root)");
        IntPtr children = IntPtr.Zero;
        try {
            var getChildren = (delegate* unmanaged[Stdcall]<IntPtr, IntPtr*, int>)(*(void***)rootContainerIface)[6];
            CheckHr(getChildren(rootContainerIface, &children), "IContainerVisual.get_Children");
            IntPtr childrenCol = QueryInterface(children, IidIVisualCollection, "QI IVisualCollection");
            try {
                var insertAtTop = (delegate* unmanaged[Stdcall]<IntPtr, IntPtr, int>)(*(void***)childrenCol)[9];
                CheckHr(insertAtTop(childrenCol, webViewVisual), "IVisualCollection.InsertAtTop");
            } finally {
                ReleaseCom(ref childrenCol);
            }
        } finally {
            ReleaseCom(ref children);
            ReleaseCom(ref rootContainerIface);
        }

        int hr = NativeMethods.D3D11CreateDevice(
            IntPtr.Zero,
            1, // D3D_DRIVER_TYPE_HARDWARE
            IntPtr.Zero,
            D3d11CreateDeviceBgraSupport,
            IntPtr.Zero,
            0,
            D3d11SdkVersion,
            out d3dDevice,
            out _,
            out d3dContext);
        if (hr < 0) {
            hr = NativeMethods.D3D11CreateDevice(
                IntPtr.Zero,
                5, // D3D_DRIVER_TYPE_WARP fallback
                IntPtr.Zero,
                D3d11CreateDeviceBgraSupport,
                IntPtr.Zero,
                0,
                D3d11SdkVersion,
                out d3dDevice,
                out _,
                out d3dContext);
            CheckHr(hr, "D3D11CreateDevice");
        }

        IntPtr dxgiDevice = QueryInterface(d3dDevice, IidIdxgiDevice, "QI IDXGIDevice");
        IntPtr inspectableDevice = IntPtr.Zero;
        try {
            CheckHr(NativeMethods.CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice, out inspectableDevice), "CreateDirect3D11DeviceFromDXGIDevice");
            winrtDevice = QueryInterface(inspectableDevice, IidIDirect3DDevice, "QI IDirect3DDevice");
        } finally {
            ReleaseCom(ref inspectableDevice);
            ReleaseCom(ref dxgiDevice);
        }

        IntPtr itemStatics = GetActivationFactory("Windows.Graphics.Capture.GraphicsCaptureItem", IidIGraphicsCaptureItemStatics);
        try {
            IntPtr item = IntPtr.Zero;
            var createFromVisual = (delegate* unmanaged[Stdcall]<IntPtr, IntPtr, IntPtr*, int>)(*(void***)itemStatics)[6];
            CheckHr(createFromVisual(itemStatics, webViewVisual, &item), "IGraphicsCaptureItemStatics.CreateFromVisual");
            captureItem = item;
        } finally {
            ReleaseCom(ref itemStatics);
        }

        IntPtr poolStatics = GetActivationFactory("Windows.Graphics.Capture.Direct3D11CaptureFramePool", IidIDirect3D11CaptureFramePoolStatics2);
        try {
            IntPtr pool = IntPtr.Zero;
            var size = new NativeMethods.SizeInt32 { Width = poolWidth, Height = poolHeight };
            var createFreeThreaded = (delegate* unmanaged[Stdcall]<IntPtr, IntPtr, int, int, NativeMethods.SizeInt32, IntPtr*, int>)(*(void***)poolStatics)[6];
            CheckHr(createFreeThreaded(poolStatics, winrtDevice, DxgiFormatB8G8R8A8Unorm, 2, size, &pool), "Direct3D11CaptureFramePool.CreateFreeThreaded");
            framePool = pool;
        } finally {
            ReleaseCom(ref poolStatics);
        }

        IntPtr session = IntPtr.Zero;
        var createSession = (delegate* unmanaged[Stdcall]<IntPtr, IntPtr, IntPtr*, int>)(*(void***)framePool)[10];
        CheckHr(createSession(framePool, captureItem, &session), "CreateCaptureSession");
        captureSession = session;

        if (TryQueryInterface(captureSession, IidIGraphicsCaptureSession2, out IntPtr session2)) {
            try {
                var putCursor = (delegate* unmanaged[Stdcall]<IntPtr, byte, int>)(*(void***)session2)[7];
                putCursor(session2, 0);
            } finally {
                ReleaseCom(ref session2);
            }
        }
        if (TryQueryInterface(captureSession, IidIGraphicsCaptureSession3, out IntPtr session3)) {
            try {
                var putBorder = (delegate* unmanaged[Stdcall]<IntPtr, byte, int>)(*(void***)session3)[7];
                putBorder(session3, 0);
            } finally {
                ReleaseCom(ref session3);
            }
        }

        var startCapture = (delegate* unmanaged[Stdcall]<IntPtr, int>)(*(void***)captureSession)[6];
        CheckHr(startCapture(captureSession), "IGraphicsCaptureSession.StartCapture");
    }

    public void AttachWebViewController(CoreWebView2CompositionController compController) {
        if (disposed || webViewContainer == IntPtr.Zero) return;
        object? rawObj = typeof(CoreWebView2CompositionController)
            .GetField("_rawNative", BindingFlags.Instance | BindingFlags.NonPublic)
            ?.GetValue(compController);
        if (rawObj != null) {
            IntPtr unk = Marshal.GetIUnknownForObject(rawObj);
            try {
                IntPtr nativeCompCtrl = QueryInterface(unk, IidICoreWebView2CompositionController, "QI ICoreWebView2CompositionController");
                try {
                    var putRootTarget = (delegate* unmanaged[Stdcall]<IntPtr, IntPtr, int>)(*(void***)nativeCompCtrl)[4];
                    CheckHr(putRootTarget(nativeCompCtrl, webViewContainer), "ICoreWebView2CompositionController.put_RootVisualTarget");
                    return;
                } finally {
                    ReleaseCom(ref nativeCompCtrl);
                }
            } finally {
                Marshal.Release(unk);
            }
        }
        compController.RootVisualTarget = Marshal.GetObjectForIUnknown(webViewContainer);
    }

    private static void SetVisualSize(IntPtr visual, int width, int height) {
        if (visual == IntPtr.Zero) return;
        var vec = new NativeMethods.Vector2Float { X = width, Y = height };
        var putSize = (delegate* unmanaged[Stdcall]<IntPtr, NativeMethods.Vector2Float, int>)(*(void***)visual)[36];
        CheckHr(putSize(visual, vec), "IVisual.put_Size");
    }

    public void Resize(int width, int height) {
        if (disposed || framePool == IntPtr.Zero || winrtDevice == IntPtr.Zero) return;
        int w = Math.Max(64, width);
        int h = Math.Max(64, height);
        if (w == poolWidth && h == poolHeight) return;
        poolWidth = w;
        poolHeight = h;
        SetVisualSize(webViewVisual, w, h);
        var size = new NativeMethods.SizeInt32 { Width = w, Height = h };
        var recreate = (delegate* unmanaged[Stdcall]<IntPtr, IntPtr, int, int, NativeMethods.SizeInt32, int>)(*(void***)framePool)[6];
        recreate(framePool, winrtDevice, DxgiFormatB8G8R8A8Unorm, 2, size);
    }

    public bool TryAcquireLatestStagingFrame(int expectedWidth, int expectedHeight, out int outWidth, out int outHeight) {
        outWidth = 0;
        outHeight = 0;
        if (disposed || framePool == IntPtr.Zero) return false;

        Resize(expectedWidth, expectedHeight);

        var tryGetNextFrame = (delegate* unmanaged[Stdcall]<IntPtr, IntPtr*, int>)(*(void***)framePool)[7];
        IntPtr latestFrame = IntPtr.Zero;
        while (true) {
            IntPtr nextFrame = IntPtr.Zero;
            int hr = tryGetNextFrame(framePool, &nextFrame);
            if (hr < 0 || nextFrame == IntPtr.Zero) break;
            if (latestFrame != IntPtr.Zero) {
                CloseAndRelease(ref latestFrame);
            }
            latestFrame = nextFrame;
        }

        if (latestFrame == IntPtr.Zero) return false;

        IntPtr surface = IntPtr.Zero;
        IntPtr dxgiAccess = IntPtr.Zero;
        IntPtr gpuTex = IntPtr.Zero;
        try {
            NativeMethods.SizeInt32 contentSize = default;
            var getContentSize = (delegate* unmanaged[Stdcall]<IntPtr, NativeMethods.SizeInt32*, int>)(*(void***)latestFrame)[8];
            getContentSize(latestFrame, &contentSize);

            var getSurface = (delegate* unmanaged[Stdcall]<IntPtr, IntPtr*, int>)(*(void***)latestFrame)[6];
            if (getSurface(latestFrame, &surface) < 0 || surface == IntPtr.Zero) return false;

            dxgiAccess = QueryInterface(surface, IidIDirect3DDxgiInterfaceAccess, "QI IDirect3DDxgiInterfaceAccess");
            Guid iidTex = IidID3D11Texture2D;
            var getInterface = (delegate* unmanaged[Stdcall]<IntPtr, Guid*, IntPtr*, int>)(*(void***)dxgiAccess)[3];
            if (getInterface(dxgiAccess, &iidTex, &gpuTex) < 0 || gpuTex == IntPtr.Zero) return false;

            NativeMethods.D3D11_TEXTURE2D_DESC desc = default;
            var getDesc = (delegate* unmanaged[Stdcall]<IntPtr, NativeMethods.D3D11_TEXTURE2D_DESC*, void>)(*(void***)gpuTex)[10];
            getDesc(gpuTex, &desc);
            if (desc.Width == 0 || desc.Height == 0) return false;

            EnsureStagingTexture((int)desc.Width, (int)desc.Height);

            var copyResource = (delegate* unmanaged[Stdcall]<IntPtr, IntPtr, IntPtr, void>)(*(void***)d3dContext)[47];
            copyResource(d3dContext, stagingTex, gpuTex);

            int cw = contentSize.Width > 0 ? Math.Min((int)desc.Width, contentSize.Width) : (int)desc.Width;
            int ch = contentSize.Height > 0 ? Math.Min((int)desc.Height, contentSize.Height) : (int)desc.Height;
            lastContentWidth = cw;
            lastContentHeight = ch;
            outWidth = cw;
            outHeight = ch;

            if (contentSize.Width >= 64 && contentSize.Height >= 64 &&
                (contentSize.Width != poolWidth || contentSize.Height != poolHeight)) {
                Resize(contentSize.Width, contentSize.Height);
            }
            return true;
        } finally {
            ReleaseCom(ref gpuTex);
            ReleaseCom(ref dxgiAccess);
            ReleaseCom(ref surface);
            CloseAndRelease(ref latestFrame);
        }
    }

    public bool TryMapStaging(out IntPtr pData, out uint rowPitch) {
        pData = IntPtr.Zero;
        rowPitch = 0;
        if (disposed || stagingTex == IntPtr.Zero || d3dContext == IntPtr.Zero) return false;
        NativeMethods.D3D11_MAPPED_SUBRESOURCE mapped = default;
        var map = (delegate* unmanaged[Stdcall]<IntPtr, IntPtr, uint, uint, uint, NativeMethods.D3D11_MAPPED_SUBRESOURCE*, int>)(*(void***)d3dContext)[14];
        if (map(d3dContext, stagingTex, 0, D3d11MapRead, 0, &mapped) < 0 || mapped.pData == IntPtr.Zero) {
            return false;
        }
        pData = mapped.pData;
        rowPitch = mapped.RowPitch;
        return true;
    }

    public void UnmapStaging() {
        if (disposed || stagingTex == IntPtr.Zero || d3dContext == IntPtr.Zero) return;
        var unmap = (delegate* unmanaged[Stdcall]<IntPtr, IntPtr, uint, void>)(*(void***)d3dContext)[15];
        unmap(d3dContext, stagingTex, 0);
    }

    private void EnsureStagingTexture(int w, int h) {
        if (stagingTex != IntPtr.Zero && stagingWidth == w && stagingHeight == h) return;
        ReleaseCom(ref stagingTex);

        var desc = new NativeMethods.D3D11_TEXTURE2D_DESC {
            Width = (uint)w,
            Height = (uint)h,
            MipLevels = 1,
            ArraySize = 1,
            Format = DxgiFormatB8G8R8A8Unorm,
            SampleDesc = new NativeMethods.DXGI_SAMPLE_DESC { Count = 1, Quality = 0 },
            Usage = D3d11UsageStaging,
            BindFlags = 0,
            CPUAccessFlags = D3d11CpuAccessRead,
            MiscFlags = 0,
        };
        IntPtr tex = IntPtr.Zero;
        var createTex2D = (delegate* unmanaged[Stdcall]<IntPtr, NativeMethods.D3D11_TEXTURE2D_DESC*, IntPtr, IntPtr*, int>)(*(void***)d3dDevice)[5];
        CheckHr(createTex2D(d3dDevice, &desc, IntPtr.Zero, &tex), "ID3D11Device.CreateTexture2D(Staging)");
        stagingTex = tex;
        stagingWidth = w;
        stagingHeight = h;
    }

    private static IntPtr ActivateInstance(string className) {
        IntPtr hstr = IntPtr.Zero;
        try {
            CheckHr(NativeMethods.WindowsCreateString(className, (uint)className.Length, out hstr), "WindowsCreateString(" + className + ")");
            CheckHr(NativeMethods.RoActivateInstance(hstr, out IntPtr instance), "RoActivateInstance(" + className + ")");
            return instance;
        } finally {
            if (hstr != IntPtr.Zero) NativeMethods.WindowsDeleteString(hstr);
        }
    }

    private static IntPtr GetActivationFactory(string className, Guid iid) {
        IntPtr hstr = IntPtr.Zero;
        try {
            CheckHr(NativeMethods.WindowsCreateString(className, (uint)className.Length, out hstr), "WindowsCreateString(" + className + ")");
            CheckHr(NativeMethods.RoGetActivationFactory(hstr, ref iid, out IntPtr factory), "RoGetActivationFactory(" + className + ")");
            return factory;
        } finally {
            if (hstr != IntPtr.Zero) NativeMethods.WindowsDeleteString(hstr);
        }
    }

    private static bool TryQueryInterface(IntPtr ptr, Guid iid, out IntPtr result) {
        result = IntPtr.Zero;
        if (ptr == IntPtr.Zero) return false;
        IntPtr outPtr = IntPtr.Zero;
        var qi = (delegate* unmanaged[Stdcall]<IntPtr, Guid*, IntPtr*, int>)(*(void***)ptr)[0];
        int hr = qi(ptr, &iid, &outPtr);
        if (hr >= 0 && outPtr != IntPtr.Zero) {
            result = outPtr;
            return true;
        }
        return false;
    }

    private static IntPtr QueryInterface(IntPtr ptr, Guid iid, string context) {
        if (TryQueryInterface(ptr, iid, out IntPtr res)) return res;
        throw new InvalidOperationException(context + " failed.");
    }

    private static void CloseAndRelease(ref IntPtr ptr) {
        if (ptr == IntPtr.Zero) return;
        if (TryQueryInterface(ptr, IidIClosable, out IntPtr closable)) {
            try {
                var close = (delegate* unmanaged[Stdcall]<IntPtr, int>)(*(void***)closable)[6];
                close(closable);
            } finally {
                ReleaseCom(ref closable);
            }
        }
        ReleaseCom(ref ptr);
    }

    private static void ReleaseCom(ref IntPtr ptr) {
        if (ptr == IntPtr.Zero) return;
        IntPtr p = ptr;
        ptr = IntPtr.Zero;
        var release = (delegate* unmanaged[Stdcall]<IntPtr, uint>)(*(void***)p)[2];
        release(p);
    }

    private static void CheckHr(int hr, string op) {
        if (hr < 0) {
            throw new InvalidOperationException($"{op} failed with HRESULT 0x{hr:X8}");
        }
    }

    public void Dispose() {
        if (disposed) return;
        disposed = true;
        CloseAndRelease(ref captureSession);
        CloseAndRelease(ref framePool);
        ReleaseCom(ref captureItem);
        ReleaseCom(ref stagingTex);
        CloseAndRelease(ref winrtDevice);
        ReleaseCom(ref d3dContext);
        ReleaseCom(ref d3dDevice);
        ReleaseCom(ref webViewVisual);
        CloseAndRelease(ref webViewContainer);
        ReleaseCom(ref windowRootVisual);
        CloseAndRelease(ref windowRootContainer);
        CloseAndRelease(ref desktopTarget);
        CloseAndRelease(ref compositor);
        ReleaseCom(ref dqController);
    }
}

internal sealed class OffscreenWebViewHost : NativeWindow, IDisposable {
    private const string VirtualOrigin = "https://app.metro.local";

    private readonly CliOptions options;
    private readonly SynchronizationContext uiContext;
    private readonly ApplicationContext appContext;
    private readonly CancellationTokenSource cts = new();
    private readonly SemaphoreSlim writeLock = new(1, 1);
    private readonly Queue<string> pendingToJs = new();

    private readonly object inputQueueLock = new();
    private readonly List<CdpInputAction> inputQueue = new();
    private bool inputPumpRunning;

    private SharedFrameBuffer? shm;
    private CoreWebView2CompositionController? compController;
    private CoreWebView2Controller? controller;
    private CoreWebView2? coreWebView;
    private System.Windows.Forms.Timer? frameTimer;
    private StreamWriter? tcpWriter;

    private int pixelWidth;
    private int pixelHeight;
    private double rasterScale = 1.0;
    private DateTime activeUntilUtc = DateTime.UtcNow.AddSeconds(4);
    private DateTime lastIdleCaptureUtc = DateTime.MinValue;
    private bool captureInProgress;
    private bool webViewReady;
    private bool shuttingDown;

    public int ExitCode { get; private set; }

    private sealed record CdpInputAction(string Method, string JsonPayload, bool IsCoalescableMove);

    public OffscreenWebViewHost(CliOptions options, SynchronizationContext uiContext, ApplicationContext appContext) {
        this.options = options;
        this.uiContext = uiContext;
        this.appContext = appContext;
        pixelWidth = options.InitialWidth;
        pixelHeight = options.InitialHeight;
        rasterScale = ComputeRasterScale(pixelWidth, pixelHeight);

        if (!string.IsNullOrWhiteSpace(options.ShmName)) {
            shm = new SharedFrameBuffer(options.ShmName);
        }

        // 1x1 invisible click-through host anchor at HWND_BOTTOM: never appears in taskbar or
        // Alt+Tab, never steals focus, never floats TOPMOST, and never paints visible desktop pixels.
        var cp = new CreateParams {
            Caption = "Station Designer Offscreen UI Anchor",
            X = 0,
            Y = 0,
            Width = 1,
            Height = 1,
            Parent = IntPtr.Zero,
            Style = unchecked((int)NativeMethods.WS_POPUP),
            ExStyle = (int)(NativeMethods.WS_EX_TOOLWINDOW | NativeMethods.WS_EX_NOACTIVATE | NativeMethods.WS_EX_TRANSPARENT | NativeMethods.WS_EX_LAYERED),
        };
        CreateHandle(cp);

        NativeMethods.SetLayeredWindowAttributes(Handle, 0, 1, NativeMethods.LWA_ALPHA);
        NativeMethods.SetWindowPos(
            Handle,
            NativeMethods.HWND_BOTTOM,
            0,
            0,
            1,
            1,
            NativeMethods.SWP_NOACTIVATE | NativeMethods.SWP_SHOWWINDOW);
    }

    public static double ComputeRasterScale(int w, int h) {
        if (h >= 1350) {
            double s = Math.Round((h / 960.0) * 20.0) / 20.0;
            return Math.Clamp(s, 1.0, 2.5);
        }
        if (h < 780) {
            double s = Math.Round((h / 780.0) * 20.0) / 20.0;
            return Math.Clamp(s, 0.65, 1.0);
        }
        return 1.0;
    }

    public void Start() {
        StartFrameAndWatchdogTimer();
        if (options.Port > 0) {
            _ = Task.Run(() => RunTcpLoopAsync(cts.Token));
        }
        _ = InitializeWebViewAsync();
    }

    protected override unsafe void WndProc(ref Message m) {
        switch (m.Msg) {
            case NativeMethods.WM_GETMINMAXINFO: {
                // Allow arbitrary offscreen render resolutions (e.g. 2560x1440 QHD or 3840x2160 4K)
                // even when the host machine's primary monitor is smaller.
                if (m.LParam != IntPtr.Zero) {
                    var mmi = (NativeMethods.MINMAXINFO*)m.LParam;
                    mmi->ptMaxSize.X = SharedFrameBuffer.MaxWidth;
                    mmi->ptMaxSize.Y = SharedFrameBuffer.MaxHeight;
                    mmi->ptMaxTrackSize.X = SharedFrameBuffer.MaxWidth;
                    mmi->ptMaxTrackSize.Y = SharedFrameBuffer.MaxHeight;
                    m.Result = IntPtr.Zero;
                    return;
                }
                break;
            }
            case NativeMethods.WM_ERASEBKGND:
                m.Result = new IntPtr(1);
                return;
            case NativeMethods.WM_MOUSEACTIVATE:
                m.Result = new IntPtr(NativeMethods.MA_NOACTIVATE);
                return;
            case NativeMethods.WM_SIZE:
                base.WndProc(ref m);
                SyncControllerBounds();
                return;
            case NativeMethods.WM_CLOSE:
                Shutdown(0);
                return;
        }
        base.WndProc(ref m);
    }

    private void SyncControllerBounds() {
        if (controller == null || Handle == IntPtr.Zero) return;
        controller.ShouldDetectMonitorScaleChanges = false;
        controller.BoundsMode = CoreWebView2BoundsMode.UseRawPixels;
        if (Math.Abs(controller.RasterizationScale - rasterScale) > 0.001) {
            controller.RasterizationScale = rasterScale;
        }
        var target = new Rectangle(0, 0, pixelWidth, pixelHeight);
        if (controller.Bounds != target) {
            controller.Bounds = target;
        }
    }

    private void ResizeSurface(int width, int height, double explicitScale) {
        int nextW = Math.Clamp(width, 64, SharedFrameBuffer.MaxWidth);
        int nextH = Math.Clamp(height, 64, SharedFrameBuffer.MaxHeight);
        double nextScale = explicitScale > 0.25 ? Math.Clamp(explicitScale, 0.5, 3.0) : ComputeRasterScale(nextW, nextH);
        if (nextW == pixelWidth && nextH == pixelHeight && Math.Abs(nextScale - rasterScale) < 0.001) return;

        pixelWidth = nextW;
        pixelHeight = nextH;
        rasterScale = nextScale;

        shm?.NotifyResize(pixelWidth, pixelHeight);
        SyncControllerBounds();
        MarkDirty(800);
    }

    private void MarkDirty(int activeMs = 450) {
        var until = DateTime.UtcNow.AddMilliseconds(activeMs);
        if (until > activeUntilUtc) activeUntilUtc = until;
    }

    private async Task InitializeWebViewAsync() {
        try {
            Directory.CreateDirectory(options.UserDataDir);
            shm?.InitializeCompositionVisual(Handle, pixelWidth, pixelHeight);

            var envOptions = new CoreWebView2EnvironmentOptions(
                "--autoplay-policy=no-user-gesture-required " +
                "--disable-backgrounding-occluded-windows " +
                "--disable-renderer-backgrounding " +
                "--disable-features=CalculateNativeWinOcclusion");
            var env = await CoreWebView2Environment.CreateAsync(null, options.UserDataDir, envOptions);
            if (shuttingDown || Handle == IntPtr.Zero) return;

            compController = await env.CreateCoreWebView2CompositionControllerAsync(Handle);
            controller = compController;
            if (shuttingDown || Handle == IntPtr.Zero) return;

            shm?.AttachWebViewCompositionController(compController);
            controller.DefaultBackgroundColor = Color.Transparent;
            SyncControllerBounds();
            controller.IsVisible = true;
            controller.MoveFocus(CoreWebView2MoveFocusReason.Programmatic);

            coreWebView = controller.CoreWebView2;
            coreWebView.Settings.AreDefaultContextMenusEnabled = false;
            coreWebView.Settings.IsStatusBarEnabled = false;
            coreWebView.Settings.IsZoomControlEnabled = false;
            coreWebView.Settings.AreDevToolsEnabled = true;

            await coreWebView.CallDevToolsProtocolMethodAsync("Emulation.setFocusEmulationEnabled", "{\"enabled\":true}");
            await coreWebView.CallDevToolsProtocolMethodAsync(
                "Emulation.setDefaultBackgroundColorOverride",
                "{\"color\":{\"r\":0,\"g\":0,\"b\":0,\"a\":0}}");

            coreWebView.AddWebResourceRequestedFilter(VirtualOrigin + "/*", CoreWebView2WebResourceContext.All);
            coreWebView.WebResourceRequested += (_, args) => HandleWebResourceRequested(env, args);
            coreWebView.WebMessageReceived += OnWebMessageReceived;

            if (options.SelfTest) {
                coreWebView.NavigationCompleted += async (_, navArgs) => {
                    try {
                        if (!navArgs.IsSuccess) {
                            Program.LogFatal(options, $"SELFTEST_NAV_FAILED status={navArgs.WebErrorStatus}");
                            Shutdown(2);
                            return;
                        }
                        await RunSelfTestProbeAsync();
                    } catch (Exception ex) {
                        Program.LogFatal(options, "SELFTEST_EXCEPTION: " + ex);
                        Shutdown(1);
                    }
                };
            }

            MarkDirty(3000);
            coreWebView.Navigate(VirtualOrigin + options.InitialRoute);
        } catch (Exception ex) {
            Program.LogFatal(options, "WebView2 init failed: " + ex);
            await SendToUnityAsync(new { kind = "log", level = "error", message = "WebView2 init failed: " + ex.Message });
            Shutdown(options.SelfTest ? 1 : 0);
        }
    }

    private async Task RunSelfTestProbeAsync() {
        if (coreWebView == null || shm == null) return;
        var sw = Stopwatch.StartNew();
        const string checkExpr = """
            (() => {
              const app = document.querySelector('#metro-unity-ui .app');
              const stage = document.querySelector('.stage');
              const topbar = document.querySelector('.topbar');
              const canvas = document.querySelector('#unity-canvas');
              if (!window.__metroStationBridge || !app || !stage || !topbar || !canvas) return false;
              const appBg = getComputedStyle(app).backgroundColor;
              const stageBg = getComputedStyle(stage).backgroundColor;
              const canvasBg = getComputedStyle(canvas).backgroundColor;
              return appBg === 'rgba(0, 0, 0, 0)' && stageBg === 'rgba(0, 0, 0, 0)' && canvasBg === 'rgba(0, 0, 0, 0)';
            })()
            """;

        bool mounted = false;
        while (sw.ElapsedMilliseconds < 12000) {
            string probe = await coreWebView.ExecuteScriptAsync(checkExpr);
            if (string.Equals(probe?.Trim(), "true", StringComparison.OrdinalIgnoreCase)) {
                mounted = true;
                break;
            }
            await Task.Delay(80);
        }

        if (!mounted) {
            string html = await coreWebView.ExecuteScriptAsync("document.body ? document.body.innerHTML.slice(0, 400) : 'no-body'");
            Program.LogFatal(options, "SELFTEST_TIMEOUT body=" + html);
            Shutdown(3);
            return;
        }

        // Dismiss #game-loading and mount a semi-transparent swatch + pointer probe to
        // verify offscreen 32-bit BGRA alpha capture AND CDP mouse input forwarding.
        await coreWebView.ExecuteScriptAsync("""
            (() => {
              const loading = document.getElementById('game-loading');
              if (loading) loading.hidden = true;
              const swatch = document.createElement('div');
              swatch.id = 'selftest-swatch';
              swatch.style.cssText = 'position:fixed;left:400px;top:300px;width:40px;height:40px;background:rgba(200,100,50,0.5);z-index:99999;pointer-events:auto;';
              window.__selftestClicks = 0;
              swatch.addEventListener('click', () => { window.__selftestClicks = (window.__selftestClicks || 0) + 1; });
              document.body.appendChild(swatch);
            })()
            """);

        // Wait for Chromium compositor to present the updated transparent frame.
        int[] centerRgba = new[] { 0, 0, 0, 255 };
        int[] topbarRgba = new[] { 0, 0, 0, 0 };
        int[] semiRgba = new[] { 0, 0, 0, 0 };
        var capWait = Stopwatch.StartNew();
        while (capWait.ElapsedMilliseconds < 4000) {
            await Task.Delay(50);
            shm.CaptureWindowFrame(Handle, pixelWidth, pixelHeight, rasterScale);
            centerRgba = shm.SamplePixelRgba(pixelWidth / 2, pixelHeight / 2);
            topbarRgba = shm.SamplePixelRgba(120, 16);
            int sx = (int)Math.Round(420 * rasterScale);
            int sy = (int)Math.Round(320 * rasterScale);
            semiRgba = shm.SamplePixelRgba(sx, sy);
            if (centerRgba[3] == 0 && topbarRgba[3] == 255 && semiRgba[3] > 100 && semiRgba[3] < 160) {
                break;
            }
        }

        // Benchmark 10 consecutive GPU staging maps + unpremultiplication writes into shared memory.
        var benchSw = Stopwatch.StartNew();
        const int benchIters = 10;
        for (int i = 0; i < benchIters; i++) {
            shm.BenchmarkRemapStagingFrame(rasterScale);
        }
        double avgCaptureMs = Math.Round(benchSw.Elapsed.TotalMilliseconds / benchIters, 2);

        // Verify CDP mouse input reaches the DOM element at exact coordinates.
        await DispatchCdpMouseImmediateAsync("mousePressed", 420 * rasterScale, 320 * rasterScale, "left", 1, 0, 1, 0, 0);
        await DispatchCdpMouseImmediateAsync("mouseReleased", 420 * rasterScale, 320 * rasterScale, "left", 0, 0, 1, 0, 0);
        await Task.Delay(40);
        string clicksRaw = await coreWebView.ExecuteScriptAsync("window.__selftestClicks || 0");
        int.TryParse(clicksRaw?.Trim(), out int clicks);

        bool alphaOk = centerRgba[3] == 0 && topbarRgba[3] == 255;
        bool inputOk = clicks >= 1;
        bool ok = alphaOk && inputOk;

        var reportObj = new {
            ok,
            mounted = true,
            transparent = alphaOk,
            offscreen = true,
            inputForwarded = inputOk,
            clicks,
            capturedFrames = shm.Sequence,
            centerRgba,
            topbarRgba,
            semiRgba,
            avgCaptureMs,
            elapsedMs = sw.ElapsedMilliseconds,
        };

        if (!string.IsNullOrWhiteSpace(options.SelfTestOut)) {
            Directory.CreateDirectory(Path.GetDirectoryName(options.SelfTestOut)!);
            File.WriteAllText(options.SelfTestOut, JsonSerializer.Serialize(reportObj));
        }

        if (!ok) {
            Program.LogFatal(options, "SELFTEST_VERIFY_FAILED " + JsonSerializer.Serialize(reportObj));
            Shutdown(4);
            return;
        }

        Console.Out.WriteLine($"SELFTEST_OK mounted=true transparent=true offscreen=true input={inputOk} avgCaptureMs={avgCaptureMs} elapsedMs={sw.ElapsedMilliseconds}");
        Shutdown(0);
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e) {
        string? msg;
        try {
            msg = e.TryGetWebMessageAsString();
        } catch {
            msg = e.WebMessageAsJson;
        }
        if (string.IsNullOrEmpty(msg)) return;

        if (msg == "__metro_dirty__") {
            MarkDirty(350);
            return;
        }

        if (msg == "__metro_overlay_ready__") {
            webViewReady = true;
            MarkDirty(2500);
            while (pendingToJs.Count > 0) {
                coreWebView?.PostWebMessageAsString(pendingToJs.Dequeue());
            }
            _ = SendToUnityAsync(new { kind = "ready", shm = options.ShmName, w = pixelWidth, h = pixelHeight, scale = rasterScale });
            return;
        }

        if (msg.StartsWith("__metro_js_error__:", StringComparison.Ordinal)) {
            _ = SendToUnityAsync(new { kind = "log", level = "error", message = msg["__metro_js_error__:".Length..] });
            return;
        }

        MarkDirty(450);
        _ = SendToUnityAsync(new { kind = "cmd", json = msg });
    }

    private void PostStateToJs(string json) {
        if (string.IsNullOrEmpty(json)) return;
        MarkDirty(350);
        if (!webViewReady || coreWebView == null) {
            if (pendingToJs.Count > 64) pendingToJs.Dequeue();
            pendingToJs.Enqueue(json);
            return;
        }
        coreWebView.PostWebMessageAsString(json);
    }

    private void StartFrameAndWatchdogTimer() {
        bool loggedCaptureError = false;
        frameTimer = new System.Windows.Forms.Timer { Interval = 16 };
        frameTimer.Tick += (_, _) => {
            if (shuttingDown) return;
            if (options.UnityPid > 0) {
                try {
                    using var proc = Process.GetProcessById(options.UnityPid);
                    if (proc.HasExited) {
                        Shutdown(0);
                        return;
                    }
                } catch {
                    Shutdown(0);
                    return;
                }
            }

            if (shm == null || controller == null || Handle == IntPtr.Zero || captureInProgress) return;
            var now = DateTime.UtcNow;
            bool isActive = now <= activeUntilUtc;
            if (!isActive && (now - lastIdleCaptureUtc).TotalMilliseconds < 32) return;

            captureInProgress = true;
            try {
                shm.CaptureWindowFrame(Handle, pixelWidth, pixelHeight, rasterScale);
                if (!isActive) lastIdleCaptureUtc = now;
            } catch (Exception ex) {
                if (!loggedCaptureError) {
                    loggedCaptureError = true;
                    Program.LogFatal(options, "WGC capture error: " + ex);
                    _ = SendToUnityAsync(new { kind = "log", level = "error", message = "WGC capture error: " + ex.Message });
                }
            } finally {
                captureInProgress = false;
            }
        };
        frameTimer.Start();
    }

    private void EnqueueCdpInput(string method, string jsonPayload, bool isCoalescableMove) {
        bool shouldStartPump = false;
        lock (inputQueueLock) {
            if (isCoalescableMove && inputQueue.Count > 0 && inputQueue[^1].IsCoalescableMove) {
                inputQueue[^1] = new CdpInputAction(method, jsonPayload, true);
            } else {
                inputQueue.Add(new CdpInputAction(method, jsonPayload, isCoalescableMove));
            }
            if (!inputPumpRunning) {
                inputPumpRunning = true;
                shouldStartPump = true;
            }
        }
        if (shouldStartPump) {
            PostOnUi(() => _ = DrainInputQueueOnUiAsync());
        }
    }

    private async Task DrainInputQueueOnUiAsync() {
        while (!shuttingDown) {
            CdpInputAction next;
            lock (inputQueueLock) {
                if (inputQueue.Count == 0) {
                    inputPumpRunning = false;
                    return;
                }
                next = inputQueue[0];
                inputQueue.RemoveAt(0);
            }
            if (coreWebView != null) {
                try {
                    await coreWebView.CallDevToolsProtocolMethodAsync(next.Method, next.JsonPayload);
                    MarkDirty(450);
                } catch {
                    // Ignore input dropped during navigation/shutdown.
                }
            }
        }
    }

    private Task<string> DispatchCdpMouseImmediateAsync(
        string cdpType,
        double rawX,
        double rawY,
        string button,
        int buttons,
        int modifiers,
        int clickCount,
        double deltaX,
        double deltaY) {
        if (coreWebView == null) return Task.FromResult("");
        string json = BuildCdpMouseJson(cdpType, rawX, rawY, button, buttons, modifiers, clickCount, deltaX, deltaY);
        return coreWebView.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent", json);
    }

    private static string ResolveCdpMouseButton(string cdpType, string button, int buttons) {
        if (cdpType == "mouseMoved" && (string.IsNullOrEmpty(button) || button == "none") && buttons != 0) {
            if ((buttons & 1) != 0) return "left";
            if ((buttons & 2) != 0) return "right";
            if ((buttons & 4) != 0) return "middle";
        }
        return string.IsNullOrEmpty(button) ? "none" : button;
    }

    private string BuildCdpMouseJson(
        string cdpType,
        double rawX,
        double rawY,
        string button,
        int buttons,
        int modifiers,
        int clickCount,
        double deltaX,
        double deltaY) {
        double scale = Math.Max(0.25, rasterScale);
        double cssX = Math.Round(rawX / scale, 2);
        double cssY = Math.Round(rawY / scale, 2);
        string cdpButton = ResolveCdpMouseButton(cdpType, button, buttons);
        return JsonSerializer.Serialize(new {
            type = cdpType,
            x = cssX,
            y = cssY,
            button = cdpButton,
            buttons,
            modifiers,
            clickCount,
            deltaX = Math.Round(deltaX, 2),
            deltaY = Math.Round(deltaY, 2),
            pointerType = "mouse",
        });
    }

    private void PostOnUi(Action action) {
        if (shuttingDown) return;
        uiContext.Post(_ => {
            if (!shuttingDown) action();
        }, null);
    }

    public void Shutdown(int exitCode) {
        if (shuttingDown) return;
        shuttingDown = true;
        ExitCode = exitCode;
        try { cts.Cancel(); } catch { }
        try { frameTimer?.Stop(); frameTimer?.Dispose(); } catch { }
        frameTimer = null;
        try { controller?.Close(); } catch { }
        compController = null;
        controller = null;
        coreWebView = null;
        try { shm?.Dispose(); } catch { }
        shm = null;
        try { if (Handle != IntPtr.Zero) DestroyHandle(); } catch { }
        try { appContext.ExitThread(); } catch { }
    }

    public void Dispose() {
        Shutdown(ExitCode);
        cts.Dispose();
        writeLock.Dispose();
    }

    private async Task RunTcpLoopAsync(CancellationToken token) {
        try {
            using var client = new TcpClient();
            await client.ConnectAsync("127.0.0.1", options.Port, token);
            client.NoDelay = true;
            using var stream = client.GetStream();
            using var reader = new StreamReader(stream, new UTF8Encoding(false));
            tcpWriter = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true };

            await SendToUnityAsync(new { kind = "connected", pid = Environment.ProcessId, shm = options.ShmName });

            while (!token.IsCancellationRequested) {
                string? line = await reader.ReadLineAsync(token);
                if (line == null) break;
                if (line.Length == 0) continue;
                HandleUnityMessage(line);
            }
        } catch (OperationCanceledException) {
            // Normal shutdown.
        } catch {
            // Host closed connection.
        } finally {
            PostOnUi(() => Shutdown(0));
        }
    }

    private void HandleUnityMessage(string line) {
        try {
            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;
            string kind = root.TryGetProperty("kind", out var k) ? k.GetString() ?? "" : "";
            switch (kind) {
                case "resize":
                case "bounds": {
                    int w = root.TryGetProperty("w", out var pw) ? pw.GetInt32() : pixelWidth;
                    int h = root.TryGetProperty("h", out var ph) ? ph.GetInt32() : pixelHeight;
                    double scale = root.TryGetProperty("scale", out var ps) ? ps.GetDouble() : 0.0;
                    if (w >= 64 && h >= 64) {
                        PostOnUi(() => ResizeSurface(w, h, scale));
                    }
                    break;
                }
                case "mouse": {
                    string ev = root.TryGetProperty("ev", out var pev) ? pev.GetString() ?? "move" : "move";
                    double x = root.TryGetProperty("x", out var px) ? px.GetDouble() : 0;
                    double y = root.TryGetProperty("y", out var py) ? py.GetDouble() : 0;
                    string button = root.TryGetProperty("button", out var pb) ? pb.GetString() ?? "none" : "none";
                    int buttons = root.TryGetProperty("buttons", out var pbs) ? pbs.GetInt32() : 0;
                    int modifiers = root.TryGetProperty("modifiers", out var pm) ? pm.GetInt32() : 0;
                    int clickCount = root.TryGetProperty("clicks", out var pc) ? pc.GetInt32() : 1;
                    double dx = root.TryGetProperty("dx", out var pdx) ? pdx.GetDouble() : 0;
                    double dy = root.TryGetProperty("dy", out var pdy) ? pdy.GetDouble() : 0;

                    string cdpType = ev switch {
                        "down" => "mousePressed",
                        "up" => "mouseReleased",
                        "wheel" => "mouseWheel",
                        _ => "mouseMoved",
                    };
                    bool coalescable = cdpType == "mouseMoved";
                    string payload = BuildCdpMouseJson(cdpType, x, y, button, buttons, modifiers, clickCount, dx, dy);
                    EnqueueCdpInput("Input.dispatchMouseEvent", payload, coalescable);
                    break;
                }
                case "key": {
                    string ev = root.TryGetProperty("ev", out var pev) ? pev.GetString() ?? "down" : "down";
                    int vk = root.TryGetProperty("vk", out var pvk) ? pvk.GetInt32() : 0;
                    string key = root.TryGetProperty("key", out var pkey) ? pkey.GetString() ?? "" : "";
                    string code = root.TryGetProperty("code", out var pcode) ? pcode.GetString() ?? "" : "";
                    string text = root.TryGetProperty("text", out var ptext) ? ptext.GetString() ?? "" : "";
                    int modifiers = root.TryGetProperty("modifiers", out var pm) ? pm.GetInt32() : 0;
                    bool repeat = root.TryGetProperty("repeat", out var pr) && pr.GetBoolean();

                    if (ev == "insertText") {
                        if (!string.IsNullOrEmpty(text)) {
                            EnqueueCdpInput("Input.insertText", JsonSerializer.Serialize(new { text }), false);
                        }
                        break;
                    }

                    string cdpType = ev switch {
                        "up" => "keyUp",
                        "char" => "char",
                        _ => "rawKeyDown",
                    };
                    string payload = JsonSerializer.Serialize(new {
                        type = cdpType,
                        modifiers,
                        windowsVirtualKeyCode = vk,
                        nativeVirtualKeyCode = vk,
                        key,
                        code,
                        text = cdpType == "char" ? text : "",
                        unmodifiedText = cdpType == "char" ? text : "",
                        autoRepeat = repeat,
                    });
                    EnqueueCdpInput("Input.dispatchKeyEvent", payload, false);
                    break;
                }
                case "bridge": {
                    string payload = root.TryGetProperty("json", out var j) ? j.GetString() ?? "" : "";
                    PostOnUi(() => PostStateToJs(payload));
                    break;
                }
                case "navigate": {
                    string route = root.TryGetProperty("route", out var r) ? r.GetString() ?? "/game/" : "/game/";
                    if (!route.StartsWith('/')) route = "/" + route;
                    PostOnUi(() => {
                        webViewReady = false;
                        MarkDirty(3000);
                        coreWebView?.Navigate(VirtualOrigin + route);
                    });
                    break;
                }
                case "capturePreview": {
                    string outPath = root.TryGetProperty("path", out var pp) ? pp.GetString() ?? "" : "";
                    if (!string.IsNullOrWhiteSpace(outPath)) {
                        PostOnUi(async () => {
                            try {
                                if (shm == null) {
                                    await SendToUnityAsync(new { kind = "previewCaptured", ok = false, path = outPath, error = "no-shm" });
                                    return;
                                }
                                shm.CaptureWindowFrame(Handle, pixelWidth, pixelHeight, rasterScale);
                                shm.SaveActiveSlotPng(outPath);
                                await SendToUnityAsync(new { kind = "previewCaptured", ok = true, path = outPath });
                            } catch (Exception ex) {
                                await SendToUnityAsync(new { kind = "previewCaptured", ok = false, path = outPath, error = ex.Message });
                            }
                        });
                    }
                    break;
                }
                case "quit":
                    PostOnUi(() => Shutdown(0));
                    break;
            }
        } catch (Exception ex) {
            _ = SendToUnityAsync(new { kind = "log", level = "error", message = "Bad host message: " + ex.Message });
        }
    }

    private async Task SendToUnityAsync(object message) {
        var writer = tcpWriter;
        if (writer == null) return;
        string json = JsonSerializer.Serialize(message);
        await writeLock.WaitAsync();
        try {
            await writer.WriteLineAsync(json);
        } catch {
            // Socket closed during shutdown.
        } finally {
            writeLock.Release();
        }
    }

    // ------------------------------------------------------------------ virtual HTTPS server

    private void HandleWebResourceRequested(CoreWebView2Environment env, CoreWebView2WebResourceRequestedEventArgs e) {
        try {
            var uri = new Uri(e.Request.Uri);
            string path = Uri.UnescapeDataString(uri.AbsolutePath);

            if (path == "/favicon.ico") {
                e.Response = env.CreateWebResourceResponse(Stream.Null, 204, "No Content", "Access-Control-Allow-Origin: *");
                return;
            }

            if (path.StartsWith("/game/_unity/UI/module-thumbnails/", StringComparison.Ordinal)) {
                string rel = path["/game/_unity/UI/module-thumbnails/".Length..];
                ServeDiskFile(env, e, Path.Combine(options.PublicDir, "module-thumbnails"), rel);
                return;
            }

            if (path.StartsWith("/game/_unity/UI/", StringComparison.Ordinal)) {
                string rel = path["/game/_unity/UI/".Length..];
                ServeDiskFile(env, e, options.UiDir, rel);
                return;
            }

            if (path.StartsWith("/game/audio/", StringComparison.Ordinal)) {
                string rel = path["/game/audio/".Length..];
                ServeDiskFile(env, e, Path.Combine(options.PublicDir, "audio"), rel);
                return;
            }

            if (path.StartsWith("/audio/", StringComparison.Ordinal)) {
                string rel = path["/audio/".Length..];
                ServeDiskFile(env, e, Path.Combine(options.PublicDir, "audio"), rel);
                return;
            }

            if (path == "/" || path == "/game" || path.StartsWith("/game/", StringComparison.Ordinal)) {
                string html = BuildOverlayHtml(options.UiDir, path);
                byte[] bytes = Encoding.UTF8.GetBytes(html);
                e.Response = env.CreateWebResourceResponse(
                    new MemoryStream(bytes),
                    200,
                    "OK",
                    "Content-Type: text/html; charset=utf-8\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *");
                return;
            }

            e.Response = env.CreateWebResourceResponse(Stream.Null, 404, "Not Found", "Content-Type: text/plain");
        } catch (Exception ex) {
            byte[] err = Encoding.UTF8.GetBytes("Resource error: " + ex.Message);
            e.Response = env.CreateWebResourceResponse(new MemoryStream(err), 500, "Internal Server Error", "Content-Type: text/plain; charset=utf-8");
        }
    }

    private static void ServeDiskFile(CoreWebView2Environment env, CoreWebView2WebResourceRequestedEventArgs e, string baseDir, string relativePath) {
        string fullBase = Path.GetFullPath(baseDir);
        if (!fullBase.EndsWith(Path.DirectorySeparatorChar)) fullBase += Path.DirectorySeparatorChar;
        string candidate = Path.GetFullPath(Path.Combine(fullBase, relativePath.Replace('/', Path.DirectorySeparatorChar)));
        if (!candidate.StartsWith(fullBase, StringComparison.OrdinalIgnoreCase) || !File.Exists(candidate)) {
            e.Response = env.CreateWebResourceResponse(Stream.Null, 404, "Not Found", "Content-Type: text/plain");
            return;
        }

        byte[] data = File.ReadAllBytes(candidate);
        string mime = MimeFor(Path.GetExtension(candidate));
        e.Response = env.CreateWebResourceResponse(
            new MemoryStream(data),
            200,
            "OK",
            $"Content-Type: {mime}\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *");
    }

    private static string MimeFor(string ext) => ext.ToLowerInvariant() switch {
        ".js" or ".mjs" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".json" => "application/json; charset=utf-8",
        ".html" => "text/html; charset=utf-8",
        ".png" => "image/png",
        ".webp" => "image/webp",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".svg" => "image/svg+xml",
        ".woff2" => "font/woff2",
        ".woff" => "font/woff",
        ".ttf" => "font/ttf",
        ".mp3" => "audio/mpeg",
        ".wav" => "audio/wav",
        ".ogg" => "audio/ogg",
        _ => "application/octet-stream",
    };

    private static string BuildOverlayHtml(string uiDir, string requestPath) {
        string manifestPath = Path.Combine(uiDir, ".vite", "manifest.json");
        if (!File.Exists(manifestPath)) {
            throw new FileNotFoundException("Missing dist-unity-ui/.vite/manifest.json. Run `npm --prefix game run build:unity-ui` first.", manifestPath);
        }

        string entryFile = "";
        string cssFile = "";
        using (var doc = JsonDocument.Parse(File.ReadAllText(manifestPath))) {
            if (doc.RootElement.TryGetProperty("src/unity-web/main.tsx", out var mainEntry)) {
                entryFile = mainEntry.TryGetProperty("file", out var f) ? f.GetString() ?? "" : "";
                if (mainEntry.TryGetProperty("css", out var cssArr) && cssArr.ValueKind == JsonValueKind.Array && cssArr.GetArrayLength() > 0) {
                    cssFile = cssArr[0].GetString() ?? "";
                }
            }
            if (string.IsNullOrEmpty(cssFile)) {
                foreach (var prop in doc.RootElement.EnumerateObject()) {
                    if (prop.Value.TryGetProperty("file", out var f)) {
                        string val = f.GetString() ?? "";
                        if (val.EndsWith(".css", StringComparison.OrdinalIgnoreCase)) {
                            cssFile = val;
                            break;
                        }
                    }
                }
            }
        }

        if (string.IsNullOrEmpty(entryFile) || string.IsNullOrEmpty(cssFile)) {
            throw new InvalidOperationException("Manifest did not contain entry or css for src/unity-web/main.tsx.");
        }

        string cleanRequestPath = requestPath.TrimEnd('/');
        bool isBenchmark = cleanRequestPath.EndsWith("/benchmark", StringComparison.OrdinalIgnoreCase)
            || cleanRequestPath.EndsWith("/benchmark/en", StringComparison.OrdinalIgnoreCase);
        bool isEn = Array.Exists(requestPath.Split('/', StringSplitOptions.RemoveEmptyEntries), s => s == "en");
        string lang = isEn ? "en" : "zh-CN";
        string loadingHiddenAttr = isBenchmark ? " hidden" : "";
        const string assetBase = "/game/_unity/UI";

        return $$"""
<!DOCTYPE html>
<html class="metro-overlay" lang="{{lang}}">
  <head>
    <meta charset="utf-8">
    <title>车站设计师 · Station Designer</title>
    <link rel="stylesheet" href="{{assetBase}}/{{cssFile}}">
    <style id="metro-overlay-style">
      html.metro-overlay {
        color-scheme: normal !important;
      }
      html.metro-overlay,
      html.metro-overlay body,
      html.metro-overlay #unity-container,
      html.metro-overlay #unity-canvas,
      html.metro-overlay #metro-unity-ui,
      html.metro-overlay .app,
      html.metro-overlay .main,
      html.metro-overlay .stage,
      html.metro-overlay .unityViewport,
      html.metro-overlay .explodedViewer[data-ready="true"],
      html.metro-overlay .explodedViewer::backdrop {
        background: transparent !important;
      }
      html.metro-overlay body:has(.explodedViewer[open]) .app {
        visibility: hidden !important;
        pointer-events: none !important;
      }
      #unity-loading-container, #unity-footer { display: none !important; }
      #game-loading { position: fixed; inset: 0; z-index: 20000; display: grid; place-items: center; padding: 24px; background: #06111d; color: #d6e7f7; font: 14px system-ui, sans-serif; }
      #game-loading[hidden] { display: none; }
      #game-loading .loading-card { width: min(390px, 100%); padding: 28px; border: 1px solid #315776; background: #0b1b2c; box-shadow: 0 20px 70px #0005; }
      #game-loading .loading-brand { color: #8fc4ee; font-size: 11px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
      #game-loading h1 { margin: 20px 0 8px; font-size: 25px; line-height: 1.2; }
      #game-loading p { margin: 0; line-height: 1.6; color: #9ab5cb; }
      #game-loading .loading-track { height: 3px; overflow: hidden; margin: 24px 0 0; background: #1d3b58; }
      #game-loading .loading-track::after { content: ''; display: block; width: 38%; height: 100%; background: #55b6ff; animation: loading-sweep 1.5s ease-in-out infinite alternate; }
      @keyframes loading-sweep { from { transform: translateX(0); } to { transform: translateX(163%); } }
      html[data-ui-theme="site"] #game-loading { background: #070a10; color: #eef3f9; }
      html[data-ui-theme="site"] #game-loading .loading-card { background: #111720; border-color: #303b49; border-radius: 6px; }
      html[data-ui-theme="site"] #game-loading .loading-brand { color: #f2b32c; }
      html[data-ui-theme="site"] #game-loading .loading-track { background: #303b49; }
      html[data-ui-theme="site"] #game-loading .loading-track::after { background: #f2b32c; }
      html[data-ui-theme="studio"] #game-loading { background: #f4f3ed; color: #303a30; }
      html[data-ui-theme="studio"] #game-loading .loading-card { background: #fdfef9; border-color: #d8dbce; border-radius: 14px; box-shadow: 0 20px 60px #35402b1c; }
      html[data-ui-theme="studio"] #game-loading .loading-brand { color: #b94d29; }
      html[data-ui-theme="studio"] #game-loading p { color: #687363; }
      html[data-ui-theme="studio"] #game-loading .loading-track { background: #e1e7d9; border-radius: 4px; }
      html[data-ui-theme="studio"] #game-loading .loading-track::after { background: #c94d24; }
    </style>
  </head>
  <body>
    <div id="game-loading" role="status" aria-live="polite"{{loadingHiddenAttr}}>
      <div class="loading-card">
        <div class="loading-brand">Station Designer</div>
        <h1 id="loading-title">正在准备车站</h1>
        <p id="loading-detail">正在连接 Unity Studio 并构建车站，请稍候。</p>
        <div class="loading-track" aria-hidden="true"></div>
      </div>
    </div>
    <div id="unity-container">
      <canvas id="unity-canvas"></canvas>
    </div>
    <script>
      (() => {
        const path = location.pathname.replace(/\/+$/, '');
        const isBenchmark = path.endsWith('/benchmark') || path.endsWith('/benchmark/en');
        if (isBenchmark) {
          const loading = document.getElementById('game-loading');
          if (loading) loading.hidden = true;
        }
        let theme, language;
        const route = path.split('/').includes('en') || document.documentElement.lang === 'en' ? 'en' : 'zh-CN';
        try {
          theme = localStorage.getItem('metro-game.ui-theme');
          if (!isBenchmark) language = localStorage.getItem('metro-game.language.' + route);
        } catch {}
        document.documentElement.dataset.uiTheme = theme === 'studio' || theme === 'site' ? theme : 'blueprint';
        const resolvedLanguage = language === 'en' || language === 'zh-CN' ? language : route;
        document.documentElement.lang = resolvedLanguage;
        if (resolvedLanguage === 'en') {
          document.getElementById('loading-title').textContent = 'Preparing your station';
          document.getElementById('loading-detail').textContent = 'Connecting to Unity Studio and building your station.';
        }
      })();
    </script>
    <script type="module">
      window.addEventListener('error', (ev) => {
        try { window.chrome.webview.postMessage('__metro_js_error__:JS error: ' + (ev.message || ev.error)); } catch {}
      });
      window.addEventListener('unhandledrejection', (ev) => {
        try { window.chrome.webview.postMessage('__metro_js_error__:Unhandled rejection: ' + ev.reason); } catch {}
      });

      let dirtyQueued = false;
      const notifyDirty = () => {
        if (dirtyQueued) return;
        dirtyQueued = true;
        requestAnimationFrame(() => {
          dirtyQueued = false;
          try { window.chrome.webview.postMessage('__metro_dirty__'); } catch {}
        });
      };
      new MutationObserver(notifyDirty).observe(document.documentElement, {
        subtree: true, childList: true, attributes: true, characterData: true
      });
      window.addEventListener('transitionrun', notifyDirty, true);
      window.addEventListener('animationstart', notifyDirty, true);
      window.addEventListener('scroll', notifyDirty, true);

      window.__metroDesktopOverlay = true;
      window.metroUnityUiBase = '{{assetBase}}/';
      window.metroUnityAudioBase = '/audio/';
      const ui = await import('{{assetBase}}/{{entryFile}}');
      const host = document.createElement('div');
      host.id = 'metro-unity-ui';
      document.body.appendChild(host);

      window.chrome.webview.addEventListener('message', (event) => {
        const detail = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
        window.dispatchEvent(new CustomEvent('metro:station-state', { detail }));
        notifyDirty();
      });

      const bridgeShim = {
        SendMessage(_objectName, _methodName, value = '') {
          window.chrome.webview.postMessage(String(value));
          notifyDirty();
        }
      };
      window.metroUnityInstance = bridgeShim;
      const unmount = ui.mountUnityUI(host, document.querySelector('#unity-canvas'));
      ui.stationBridge.register(bridgeShim);
      window.chrome.webview.postMessage('__metro_overlay_ready__');

      window.addEventListener('pagehide', () => {
        unmount();
      }, { once: true });
    </script>
  </body>
</html>
""";
    }
}

internal static class NativeMethods {
    public const uint WS_POPUP = 0x80000000u;
    public const uint WS_EX_TRANSPARENT = 0x00000020u;
    public const uint WS_EX_TOOLWINDOW = 0x00000080u;
    public const uint WS_EX_NOACTIVATE = 0x08000000u;
    public const uint WS_EX_LAYERED = 0x00080000u;
    public const uint LWA_ALPHA = 0x00000002u;

    public const int WM_SIZE = 0x0005;
    public const int WM_CLOSE = 0x0010;
    public const int WM_ERASEBKGND = 0x0014;
    public const int WM_MOUSEACTIVATE = 0x0021;
    public const int WM_GETMINMAXINFO = 0x0024;
    public const int MA_NOACTIVATE = 3;

    public const uint DWM_BB_ENABLE = 0x00000001;
    public const uint DWM_BB_BLURREGION = 0x00000002;
    public const int DWMWA_NCRENDERING_POLICY = 2;
    public const int DWMWA_TRANSITIONS_FORCEDISABLED = 3;
    public const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;

    public static readonly IntPtr HWND_BOTTOM = new IntPtr(1);
    public const uint SWP_NOZORDER = 0x0004;
    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint SWP_SHOWWINDOW = 0x0040;

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct SizeInt32 {
        public int Width;
        public int Height;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct Vector2Float {
        public float X;
        public float Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DispatcherQueueOptions {
        public int dwSize;
        public int threadType;
        public int apartmentType;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MINMAXINFO {
        public POINT ptReserved;
        public POINT ptMaxSize;
        public POINT ptMaxPosition;
        public POINT ptMinTrackSize;
        public POINT ptMaxTrackSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MARGINS {
        public int cxLeftWidth;
        public int cxRightWidth;
        public int cyTopHeight;
        public int cyBottomHeight;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DWM_BLURBEHIND {
        public uint dwFlags;
        [MarshalAs(UnmanagedType.Bool)]
        public bool fEnable;
        public IntPtr hRgnBlur;
        [MarshalAs(UnmanagedType.Bool)]
        public bool fTransitionOnMaximized;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DXGI_SAMPLE_DESC {
        public uint Count;
        public uint Quality;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct D3D11_TEXTURE2D_DESC {
        public uint Width;
        public uint Height;
        public uint MipLevels;
        public uint ArraySize;
        public uint Format;
        public DXGI_SAMPLE_DESC SampleDesc;
        public uint Usage;
        public uint BindFlags;
        public uint CPUAccessFlags;
        public uint MiscFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct D3D11_MAPPED_SUBRESOURCE {
        public IntPtr pData;
        public uint RowPitch;
        public uint DepthPitch;
    }

    [DllImport("dwmapi.dll")]
    public static extern int DwmExtendFrameIntoClientArea(IntPtr hWnd, ref MARGINS pMarInset);

    [DllImport("dwmapi.dll")]
    public static extern int DwmEnableBlurBehindWindow(IntPtr hWnd, ref DWM_BLURBEHIND pBlurBehind);

    [DllImport("dwmapi.dll")]
    public static extern int DwmSetWindowAttribute(IntPtr hwnd, int dwAttribute, ref int pvAttribute, int cbAttribute);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateRectRgn(int nLeftRect, int nTopRect, int nRightRect, int nBottomRect);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteObject(IntPtr hObject);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint crKey, byte bAlpha, uint dwFlags);

    [DllImport("d3d11.dll", ExactSpelling = true)]
    public static extern int D3D11CreateDevice(
        IntPtr pAdapter,
        int driverType,
        IntPtr software,
        uint flags,
        IntPtr pFeatureLevels,
        uint featureLevels,
        uint sdkVersion,
        out IntPtr ppDevice,
        out int pFeatureLevel,
        out IntPtr ppImmediateContext);

    [DllImport("d3d11.dll", ExactSpelling = true)]
    public static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgiDevice, out IntPtr graphicsDevice);

    [DllImport("combase.dll", ExactSpelling = true)]
    public static extern int WindowsCreateString(
        [MarshalAs(UnmanagedType.LPWStr)] string sourceString,
        uint length,
        out IntPtr hstring);

    [DllImport("combase.dll", ExactSpelling = true)]
    public static extern int WindowsDeleteString(IntPtr hstring);

    [DllImport("combase.dll", ExactSpelling = true)]
    public static extern int RoActivateInstance(IntPtr activatableClassId, out IntPtr instance);

    [DllImport("combase.dll", ExactSpelling = true)]
    public static extern int RoGetActivationFactory(IntPtr activatableClassId, ref Guid iid, out IntPtr factory);

    [DllImport("CoreMessaging.dll", ExactSpelling = true)]
    public static extern int CreateDispatcherQueueController(DispatcherQueueOptions options, out IntPtr dispatcherQueueController);
}
