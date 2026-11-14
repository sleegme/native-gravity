param([string]$Request, [string]$RequestFile, [switch]$CompileOnly)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class NaviKitJob {
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimit {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
        public uint ActiveLimit;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters { public ulong A, B, C, D, E, F; }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimit {
        public BasicLimit Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct Completion { public IntPtr Key, Port; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct Startup {
        public uint Size;
        public string Reserved, Desktop, Title;
        public uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
        public ushort ShowWindow, ReservedSize;
        public IntPtr ReservedPointer, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr CreateIoCompletionPort(IntPtr file, IntPtr port, UIntPtr key, uint threads);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetQueuedCompletionStatus(IntPtr port, out uint message, out UIntPtr key,
        out IntPtr overlapped, uint timeout);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes,
        IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment,
        string directory, ref Startup startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool waitAll, uint timeout);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool RemoveDirectory(string path);
    [DllImport("kernel32.dll")]
    static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr handle);

    static void Check(bool result) {
        if (!result) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    static void SetInfo<T>(IntPtr job, int kind, T value) {
        int size = Marshal.SizeOf(typeof(T));
        IntPtr memory = Marshal.AllocHGlobal(size);
        try {
            Marshal.StructureToPtr(value, memory, false);
            Check(SetInformationJobObject(job, kind, memory, (uint)size));
        } finally { Marshal.FreeHGlobal(memory); }
    }
    static string Quote(string value) {
        StringBuilder result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append(c); }
            else { result.Append('\\', slashes); result.Append(c); }
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        return result.Append('"').ToString();
    }
    public static string ValidateProfile(string directory) {
        string full = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar);
        string temporary = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);
        string name = Path.GetFileName(full);
        if (!Path.IsPathRooted(directory) || !name.StartsWith("ntg-navi-", StringComparison.Ordinal)
            || name.Length <= 9
            || !String.Equals(Path.GetDirectoryName(full), temporary, StringComparison.OrdinalIgnoreCase)
            || !String.Equals(full, Environment.GetEnvironmentVariable("HOME"), StringComparison.OrdinalIgnoreCase)
            || !String.Equals(full, Environment.GetEnvironmentVariable("USERPROFILE"), StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Invalid private profile");
        if ((File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0)
            throw new ArgumentException("Invalid private profile");
        return full;
    }
    public static void CleanupProfile(string directory) {
        DeleteProfileContents(ValidateProfile(directory));
    }
    static void DeleteProfileContents(string directory) {
        foreach (string entry in Directory.EnumerateFileSystemEntries(directory)) {
            FileAttributes attributes = File.GetAttributes(entry);
            bool link = (attributes & FileAttributes.ReparsePoint) != 0;
            if ((attributes & FileAttributes.Directory) != 0) {
                if (link) Check(RemoveDirectory(entry));
                else DeleteProfileContents(entry);
            } else {
                if (!link && (attributes & FileAttributes.ReadOnly) != 0)
                    File.SetAttributes(entry, attributes & ~FileAttributes.ReadOnly);
                File.Delete(entry);
            }
        }
        Check(RemoveDirectory(directory));
    }
    public static void CleanupCertificate() {
        // The Node owner may already have closed its stderr pipe.
        try { Console.Error.WriteLine("\nNAVI_JOB_CLEANUP_PASS"); }
        catch (IOException) { }
    }
    static void EmptyJob(IntPtr job, IntPtr port, bool production) {
        Check(TerminateJobObject(job, 0));
        Stopwatch deadline = Stopwatch.StartNew();
        while (deadline.ElapsedMilliseconds < 10000) {
            uint message; UIntPtr key; IntPtr overlapped;
            uint remaining = (uint)Math.Max(1, 10000 - deadline.ElapsedMilliseconds);
            bool returned = GetQueuedCompletionStatus(port, out message, out key, out overlapped, remaining);
            int error = returned ? 0 : Marshal.GetLastWin32Error();
            if (!production)
                Console.Error.WriteLine("NAVI_JOB_DIAGNOSTIC {\"operation\":\"GetQueuedCompletionStatus\",\"returned\":"
                    + (returned ? "true" : "false") + ",\"win32_error\":" + error + ",\"message\":" + message + "}");
            if (!returned) throw new Win32Exception(error);
            if (message == 4) return; // ACTIVE_PROCESS_ZERO.
        }
        throw new TimeoutException("Job cleanup was not confirmed");
    }
    public static int Run(string executable, string[] arguments, int timeout, int parentPid,
        string cleanupDirectory, bool propagateExitCode, string directory) {
        IntPtr job = IntPtr.Zero, port = IntPtr.Zero, parent = IntPtr.Zero, relay = IntPtr.Zero;
        ProcessInfo process = new ProcessInfo();
        bool assigned = false;
        string ownedProfile = null;
        try {
            if (propagateExitCode && !String.IsNullOrEmpty(cleanupDirectory))
                ownedProfile = ValidateProfile(cleanupDirectory);
            if (timeout < 0 || parentPid < 0) throw new ArgumentException("Invalid lifecycle options");
            if (parentPid != 0) {
                parent = OpenProcess(0x00100000, false, (uint)parentPid); // SYNCHRONIZE only.
                if (parent == IntPtr.Zero && Marshal.GetLastWin32Error() == 87) return 130;
                Check(parent != IntPtr.Zero);
                uint ownerState = WaitForSingleObject(parent, 0);
                if (ownerState == 0) return 130;
                if (ownerState != 258) throw new Win32Exception(Marshal.GetLastWin32Error());
            }
            string relayText = Environment.GetEnvironmentVariable("NTG_NAVI_RELAY_PID");
            if (propagateExitCode && !String.IsNullOrEmpty(relayText)) {
                int relayPid;
                if (parentPid == 0 || !Int32.TryParse(relayText, out relayPid) || relayPid <= 0)
                    throw new ArgumentException("Invalid supervisor");
                relay = OpenProcess(0x00100000, false, (uint)relayPid);
                if (relay == IntPtr.Zero && Marshal.GetLastWin32Error() == 87) return 130;
                Check(relay != IntPtr.Zero);
            }
            job = CreateJobObject(IntPtr.Zero, null);
            Check(job != IntPtr.Zero);
            ExtendedLimit limits = new ExtendedLimit();
            limits.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE, no breakaway.
            SetInfo(job, 9, limits);
            port = CreateIoCompletionPort(new IntPtr(-1), IntPtr.Zero, UIntPtr.Zero, 1);
            Check(port != IntPtr.Zero);
            Completion completion = new Completion();
            completion.Key = job; completion.Port = port;
            SetInfo(job, 7, completion);
            Startup startup = new Startup();
            startup.Size = (uint)Marshal.SizeOf(typeof(Startup));
            startup.Flags = 0x100;
            startup.Input = GetStdHandle(-10);
            startup.Output = GetStdHandle(-11);
            startup.Error = GetStdHandle(-12);
            foreach (IntPtr handle in new IntPtr[] { startup.Input, startup.Output, startup.Error })
                Check(SetHandleInformation(handle, 1, 1));
            StringBuilder command = new StringBuilder(Quote(executable));
            foreach (string argument in arguments) command.Append(" ").Append(Quote(argument));
            Check(CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, true,
                0x08000004, IntPtr.Zero, String.IsNullOrEmpty(directory) ? null : directory,
                ref startup, out process));
            Check(AssignProcessToJobObject(job, process.Process));
            assigned = true;
            Check(ResumeThread(process.Thread) != UInt32.MaxValue);
            uint wait = parent == IntPtr.Zero
                ? WaitForSingleObject(process.Process, (uint)timeout)
                : relay == IntPtr.Zero
                    ? WaitForMultipleObjects(2, new IntPtr[] { process.Process, parent }, false, (uint)timeout)
                    : WaitForMultipleObjects(3, new IntPtr[] { process.Process, parent, relay }, false, (uint)timeout);
            if (wait != 0 && wait != 1 && wait != 2 && wait != 258)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            uint code = 124;
            if (wait == 0) Check(GetExitCodeProcess(process.Process, out code));
            if (wait == 1 || wait == 2) code = 130;
            if (!propagateExitCode) Console.Error.WriteLine("NAVI_JOB_CHILD_EXIT_CODE " + code);
            // The bridge deliberately returns 1 when its server is terminated.
            // Legacy kit status certifies cleanup, not backend success.
            return propagateExitCode ? unchecked((int)code) : (wait == 0 ? 0 : (int)code);
        } finally {
            try {
                if (assigned) EmptyJob(job, port, propagateExitCode);
                else if (process.Process != IntPtr.Zero) {
                    Check(TerminateProcess(process.Process, 1));
                    uint stopped = WaitForSingleObject(process.Process, 10000);
                    if (stopped != 0) throw new TimeoutException("Suspended process cleanup was not confirmed");
                }
                if (ownedProfile != null) {
                    CleanupProfile(ownedProfile);
                    CleanupCertificate();
                }
            } finally {
                if (job != IntPtr.Zero) CloseHandle(job);
                if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread);
                if (process.Process != IntPtr.Zero) CloseHandle(process.Process);
                if (parent != IntPtr.Zero) CloseHandle(parent);
                if (relay != IntPtr.Zero) CloseHandle(relay);
                if (port != IntPtr.Zero) CloseHandle(port);
            }
        }
    }
}
'@
if ($CompileOnly) { Write-Output 'NAVI_JOB_COMPILE_PASS'; exit 0 }
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { exit 2 }
$production = [bool]$RequestFile
$ownedProfile = $null
$runStarted = $false
try {
    if ($RequestFile) {
        $ownedProfile = [NaviKitJob]::ValidateProfile([IO.Path]::GetDirectoryName($RequestFile))
        if ($Request -or ![IO.Path]::IsPathRooted($RequestFile) -or
            [IO.Path]::GetFullPath($RequestFile) -ne [IO.Path]::Combine($ownedProfile, '.job-request.json')) {
            throw [ArgumentException]::new('Invalid private request file')
        }
        $data = [IO.File]::ReadAllText($RequestFile, [Text.Encoding]::UTF8) | ConvertFrom-Json
        if ($env:NTG_NAVI_RELAY_PID -and
            ![IO.File]::Exists([IO.Path]::Combine($ownedProfile, '.job-supervisor.pid'))) {
            throw [ArgumentException]::new('Missing supervisor readiness')
        }
        if ($data.propagateExitCode -ne $true -or $data.cleanupDirectory -ne $ownedProfile) {
            throw [ArgumentException]::new('Invalid private lifecycle request')
        }
    } else {
        $data = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Request)) | ConvertFrom-Json
    }
    $production = $production -or $data.propagateExitCode -eq $true
    $timeout = 600000
    if ($null -ne $data.timeout) { $timeout = [int]$data.timeout }
    $parentPid = [int]$data.parentPid
    $runStarted = $true
    exit [NaviKitJob]::Run([string]$data.executable, [string[]]$data.arguments, $timeout,
        $parentPid, [string]$data.cleanupDirectory, $production, [string]$data.cwd)
} catch {
    if (!$runStarted -and $ownedProfile) {
        try {
            [NaviKitJob]::CleanupProfile($ownedProfile)
            [NaviKitJob]::CleanupCertificate()
        } catch {
            [Console]::Error.WriteLine('NAVI_JOB_CLEANUP_FAILED')
        }
    }
    $exception = $_.Exception
    while ($exception.InnerException) { $exception = $exception.InnerException }
    $errorRecord = @{
        exception_type = $exception.GetType().FullName
        message = $(if ($production) { 'Windows job failed' } else { $exception.Message })
        hresult = $exception.HResult
    }
    if ($exception -is [System.ComponentModel.Win32Exception]) {
        $errorRecord.win32_error = $exception.NativeErrorCode
    }
    [Console]::Error.WriteLine('NAVI_JOB_EXCEPTION ' + ($errorRecord | ConvertTo-Json -Compress))
    [Console]::Error.WriteLine('NAVI_JOB_FAILED')
    exit 1
}
