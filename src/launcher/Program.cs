using System.Diagnostics;
using System.ComponentModel;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace IronHandsForge.Launcher;

internal static class Program
{
    private const string AppId = "iron-hands-forge";
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public static async Task<int> Main(string[] args)
    {
        try { Console.OutputEncoding = new UTF8Encoding(false); } catch (IOException) { }
        Options? options = null;
        try
        {
            options = Options.Parse(args);
            if (options.Help)
            {
                Console.WriteLine("Iron Hands Forge\nUsage: IronHandsForge.exe [--no-browser] [--data-root PATH] [--state-root PATH] [--port NUMBER]\nCtrl+C stops only the server started by this launcher.");
                return 0;
            }
            return await Run(options);
        }
        catch (OperationCanceledException) { return 0; }
        catch (Exception error)
        {
            Console.Error.WriteLine("Iron Hands Forge: " + error.Message);
            if (options is { NoBrowser: false } && !Console.IsInputRedirected)
            {
                Console.Error.WriteLine("Press Enter to close this window.");
                Console.ReadLine();
            }
            return 1;
        }
    }

    private static async Task<int> Run(Options options)
    {
        var productRoot = NormalizePath(AppContext.BaseDirectory);
        var nodePath = Path.Combine(productRoot, "runtime", "node.exe");
        var serverPath = Path.Combine(productRoot, "app", "server.cjs");
        if (!File.Exists(nodePath)) throw new IOException("runtime/node.exe is missing. Keep the complete application folder beside IronHandsForge.exe.");
        if (!File.Exists(serverPath)) throw new IOException("app/server.cjs is missing. Keep the complete application folder beside IronHandsForge.exe.");
        var version = ReadVersion(Path.Combine(productRoot, "package.json"));
        var config = ReadJson<Configuration>(Path.Combine(productRoot, "forge.config.json")) ?? new();
        var stateRoot = ResolvePath(productRoot, options.StateRoot, "state");
        var settings = ReadJson<Configuration>(Path.Combine(stateRoot, "settings.json"));
        var dataRoot = ResolvePath(productRoot, options.DataRoot ?? config.DataRoot ?? settings?.DataRoot, "data");
        var preferredPort = options.Port ?? config.Port ?? 8767;
        if (preferredPort is < 1 or > 65535) throw new ArgumentException("The configured port must be between 1 and 65535.");
        var cacheRoot = Path.Combine(productRoot, "cache");
        var temporaryRoot = Path.Combine(cacheRoot, "tmp");
        var nodeCache = Path.Combine(cacheRoot, "node");
        var logRoot = Path.Combine(stateRoot, "logs");
        foreach (var path in new[] { stateRoot, dataRoot, cacheRoot, temporaryRoot, nodeCache, logRoot }) Directory.CreateDirectory(path);
        Environment.SetEnvironmentVariable("TEMP", temporaryRoot);
        Environment.SetEnvironmentVariable("TMP", temporaryRoot);
        Environment.SetEnvironmentVariable("NODE_COMPILE_CACHE", nodeCache);
        Environment.SetEnvironmentVariable("NODE_DISABLE_COMPILE_CACHE", "1");

        using var handler = new HttpClientHandler { UseProxy = false };
        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromMilliseconds(850) };
        using var cancellation = new CancellationTokenSource();
        ConsoleCancelEventHandler cancelHandler = (_, e) => { e.Cancel = true; cancellation.Cancel(); };
        Console.CancelKeyPress += cancelHandler;
        Process? ownedServer = null;
        using var serverLifetime = new OwnedProcessLifetime();
        TextWriter? serverLog = null;
        Task[] pumps = [];
        FileStream? startupLock = null;
        try
        {
            // A file handle survives async thread changes and is released by Windows if this process exits.
            startupLock = await AcquireStartupLock(Path.Combine(cacheRoot, "launcher-start.lock"), cancellation.Token);

            var candidates = new[] { preferredPort }.Concat(Enumerable.Range(8767, 11)).Distinct().ToArray();
            // Discover all existing instances first: a previously occupied preferred
            // port may now be free while this product is still running on a fallback.
            foreach (var port in candidates)
            {
                cancellation.Token.ThrowIfCancellationRequested();
                var existing = await GetHealth(client, port, cancellation.Token);
                if (Matches(existing, productRoot, version, dataRoot, stateRoot) && existing!.Ready)
                {
                    PrintReady(port, version, dataRoot, existing.ResourcesReady, reused: true);
                    ReleaseLock(ref startupLock);
                    if (!options.NoBrowser) OpenBrowser(port);
                    return 0;
                }
            }
            foreach (var port in candidates)
            {
                cancellation.Token.ThrowIfCancellationRequested();
                if (!IsPortFree(port)) continue;

                var logPath = Path.Combine(logRoot, $"server-{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Environment.ProcessId}.log");
                serverLog = TextWriter.Synchronized(new StreamWriter(new FileStream(logPath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite), new UTF8Encoding(false)) { AutoFlush = true });
                var start = new ProcessStartInfo(nodePath)
                {
                    WorkingDirectory = productRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8,
                    StandardErrorEncoding = Encoding.UTF8
                };
                foreach (var argument in new[] { serverPath, "--data-root", dataRoot, "--state-root", stateRoot, "--port", port.ToString(System.Globalization.CultureInfo.InvariantCulture) }) start.ArgumentList.Add(argument);
                start.Environment["TEMP"] = temporaryRoot;
                start.Environment["TMP"] = temporaryRoot;
                start.Environment["NODE_COMPILE_CACHE"] = nodeCache;
                start.Environment["NODE_DISABLE_COMPILE_CACHE"] = "1";
                ownedServer = Process.Start(start) ?? throw new IOException("Windows could not start runtime/node.exe.");
                serverLifetime.Attach(ownedServer);
                pumps = [Pump(ownedServer.StandardOutput, serverLog, "stdout"), Pump(ownedServer.StandardError, serverLog, "stderr")];

                Health? health = null;
                var watch = Stopwatch.StartNew();
                while (watch.Elapsed < TimeSpan.FromSeconds(25) && !ownedServer.HasExited)
                {
                    cancellation.Token.ThrowIfCancellationRequested();
                    health = await GetHealth(client, port, cancellation.Token);
                    if (Matches(health, productRoot, version, dataRoot, stateRoot) && health!.Ready) break;
                    await Task.Delay(180, cancellation.Token);
                }
                if (ownedServer.HasExited)
                {
                    var exit = ownedServer.ExitCode;
                    await Task.WhenAll(pumps);
                    ownedServer.Dispose(); ownedServer = null;
                    serverLog.Dispose(); serverLog = null; pumps = [];
                    // Another process may have won the bind race after our free-port probe.
                    if (!IsPortFree(port)) continue;
                    throw new IOException($"The server exited with code {exit}. See {logPath}");
                }
                if (!Matches(health, productRoot, version, dataRoot, stateRoot) || !health!.Ready)
                    throw new IOException($"The server did not pass its application/root/version health check. See {logPath}");

                ReleaseLock(ref startupLock);
                PrintReady(port, version, dataRoot, health.ResourcesReady, reused: false);
                Console.WriteLine("Log: " + logPath);
                Console.WriteLine("Leave this window open. Ctrl+C stops this server.");
                if (!options.NoBrowser) OpenBrowser(port);
                await ownedServer.WaitForExitAsync(cancellation.Token);
                await Task.WhenAll(pumps);
                return ownedServer.ExitCode;
            }
            throw new IOException("No application port is available. Ports 8767-8777 are occupied; existing services were left running.");
        }
        finally
        {
            ReleaseLock(ref startupLock);
            Console.CancelKeyPress -= cancelHandler;
            if (ownedServer is not null)
            {
                if (!ownedServer.HasExited)
                {
                    try { ownedServer.Kill(entireProcessTree: true); await ownedServer.WaitForExitAsync(); }
                    catch (InvalidOperationException) { }
                }
                if (pumps.Length > 0) await Task.WhenAll(pumps);
                ownedServer.Dispose();
            }
            serverLog?.Dispose();
        }
    }

    private static async Task Pump(StreamReader reader, TextWriter writer, string source)
    {
        while (await reader.ReadLineAsync() is { } line) writer.WriteLine($"{DateTimeOffset.UtcNow:O} [{source}] {line}");
    }

    private static async Task<Health?> GetHealth(HttpClient client, int port, CancellationToken cancellation)
    {
        try
        {
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            deadline.CancelAfter(TimeSpan.FromMilliseconds(850));
            using var response = await client.GetAsync($"http://127.0.0.1:{port}/api/health", HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            if (!response.IsSuccessStatusCode || response.Content.Headers.ContentLength > 65536) return null;
            await using var stream = await response.Content.ReadAsStreamAsync(deadline.Token);
            var buffer = new byte[65537];
            var length = 0;
            while (length < buffer.Length)
            {
                var read = await stream.ReadAsync(buffer.AsMemory(length), deadline.Token);
                if (read == 0) break;
                length += read;
            }
            return length > 65536 ? null : JsonSerializer.Deserialize<Health>(buffer.AsSpan(0, length), JsonOptions);
        }
        catch (OperationCanceledException) when (!cancellation.IsCancellationRequested) { return null; }
        catch (HttpRequestException) { return null; }
        catch (IOException) { return null; }
        catch (JsonException) { return null; }
    }

    private static bool Matches(Health? health, string root, string version, string data, string state) =>
        health is not null && health.AppId == AppId && health.Version == version &&
        SamePath(health.AppRoot, root) && SamePath(health.DataRoot, data) && SamePath(health.StateRoot, state);

    private static bool SamePath(string? left, string right)
    {
        if (string.IsNullOrWhiteSpace(left)) return false;
        try { return string.Equals(NormalizePath(left), NormalizePath(right), StringComparison.OrdinalIgnoreCase); }
        catch (ArgumentException) { return false; }
        catch (NotSupportedException) { return false; }
    }

    private static bool IsPortFree(int port)
    {
        var listener = new TcpListener(IPAddress.Loopback, port);
        try { listener.Start(); return true; }
        catch (SocketException) { return false; }
        finally { listener.Stop(); }
    }

    private static void OpenBrowser(int port)
    {
        var url = $"http://127.0.0.1:{port}/";
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception error) { Console.Error.WriteLine($"Could not open the default browser: {error.Message}\nOpen {url}"); }
    }

    private static void PrintReady(int port, string version, string data, bool resourcesReady, bool reused)
    {
        Console.WriteLine($"Iron Hands Forge {version}{(reused ? " — existing instance" : "")}");
        Console.WriteLine($"Open: http://127.0.0.1:{port}/");
        Console.WriteLine("Data: " + data);
        if (!resourcesReady) Console.WriteLine("Model data is not ready yet. Use the setup controls in the application.");
    }

    private static async Task<FileStream> AcquireStartupLock(string path, CancellationToken cancellation)
    {
        var watch = Stopwatch.StartNew();
        while (true)
        {
            cancellation.ThrowIfCancellationRequested();
            try { return new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
            catch (IOException) when (watch.Elapsed < TimeSpan.FromSeconds(25))
            { await Task.Delay(200, cancellation); }
            catch (IOException error)
            { throw new IOException("Another launcher is still starting this application, or the startup lock cannot be opened. Try again shortly.", error); }
        }
    }

    private static void ReleaseLock(ref FileStream? handle)
    {
        handle?.Dispose(); handle = null;
    }

    private static string NormalizePath(string path) => Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));
    private static string ResolvePath(string root, string? value, string fallback) => NormalizePath(Path.Combine(root, string.IsNullOrWhiteSpace(value) ? fallback : value));

    private static T? ReadJson<T>(string path)
    {
        if (!File.Exists(path)) return default;
        try { return JsonSerializer.Deserialize<T>(File.ReadAllText(path), JsonOptions); }
        catch (JsonException error) { throw new IOException($"Invalid JSON in {path}: {error.Message}", error); }
    }

    private static string ReadVersion(string path)
    {
        if (!File.Exists(path)) throw new IOException("package.json is missing from the application folder.");
        using var json = JsonDocument.Parse(File.ReadAllText(path));
        if (!json.RootElement.TryGetProperty("version", out var value) || string.IsNullOrWhiteSpace(value.GetString()))
            throw new IOException("package.json must define the application version.");
        return value.GetString()!;
    }

    private sealed class Configuration
    {
        public string? DataRoot { get; set; }
        public int? Port { get; set; }
    }

    private sealed class Health
    {
        public string? AppId { get; set; }
        public string? Version { get; set; }
        public string? AppRoot { get; set; }
        public string? DataRoot { get; set; }
        public string? StateRoot { get; set; }
        public bool Ready { get; set; }
        public bool ResourcesReady { get; set; }
    }

    private sealed class Options
    {
        public bool NoBrowser { get; private set; }
        public bool Help { get; private set; }
        public string? DataRoot { get; private set; }
        public string? StateRoot { get; private set; }
        public int? Port { get; private set; }

        public static Options Parse(string[] args)
        {
            var result = new Options();
            for (var i = 0; i < args.Length; i++)
            {
                string Value()
                {
                    if (i + 1 >= args.Length) throw new ArgumentException($"{args[i]} requires a value.");
                    return args[++i];
                }
                switch (args[i])
                {
                    case "--no-browser": result.NoBrowser = true; break;
                    case "--help": case "-h": result.Help = true; break;
                    case "--data-root": result.DataRoot = Value(); break;
                    case "--state-root": result.StateRoot = Value(); break;
                    case "--port": result.Port = int.TryParse(Value(), out var port) ? port : throw new ArgumentException("--port requires an integer."); break;
                    default: throw new ArgumentException($"Unknown argument: {args[i]}. Use --help.");
                }
            }
            return result;
        }
    }

    // Closing the console or terminating the launcher must not orphan its hidden Node process.
    // The unnamed job contains only processes started by this launcher, never reused instances.
    private sealed class OwnedProcessLifetime : IDisposable
    {
        private const uint KillOnJobClose = 0x00002000;
        private readonly SafeFileHandle handle;

        public OwnedProcessLifetime()
        {
            handle = CreateJobObject(IntPtr.Zero, null);
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not create the server lifetime job.");
            var limits = new ExtendedLimitInformation();
            limits.BasicLimitInformation.LimitFlags = KillOnJobClose;
            if (!SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimitInformation>()))
            {
                var error = Marshal.GetLastWin32Error();
                handle.Dispose();
                throw new Win32Exception(error, "Could not configure the server lifetime job.");
            }
        }

        public void Attach(Process process)
        {
            if (!AssignProcessToJobObject(handle, process.Handle))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not attach the hidden server to this launcher.");
        }

        public void Dispose() => handle.Dispose();

        [StructLayout(LayoutKind.Sequential)]
        private struct BasicLimitInformation
        {
            public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IoCounters
        {
            public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
            public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ExtendedLimitInformation
        {
            public BasicLimitInformation BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateJobObject(IntPtr securityAttributes, string? name);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetInformationJobObject(SafeFileHandle job, int informationClass, ref ExtendedLimitInformation information, uint informationLength);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool AssignProcessToJobObject(SafeFileHandle job, IntPtr process);
    }
}
