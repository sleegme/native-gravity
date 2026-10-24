param([string]$Request, [switch]$CompileOnly)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
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
    static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateProcess(IntPtr process, uint code);
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
    public static int Run(string executable, string[] arguments, int timeout) {
        IntPtr job = IntPtr.Zero, port = IntPtr.Zero;
        ProcessInfo process = new ProcessInfo();
        bool assigned = false;
        try {
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
                0x08000004, IntPtr.Zero, null, ref startup, out process));
            Check(AssignProcessToJobObject(job, process.Process));
            assigned = true;
            Check(ResumeThread(process.Thread) != UInt32.MaxValue);
            uint wait = WaitForSingleObject(process.Process, (uint)timeout);
            if (wait != 0 && wait != 258) throw new Win32Exception(Marshal.GetLastWin32Error());
            uint code = 124;
            if (wait == 0) Check(GetExitCodeProcess(process.Process, out code));
            Console.Error.WriteLine("NAVI_JOB_CHILD_EXIT_CODE " + code);
            Check(TerminateJobObject(job, 0));
            Stopwatch deadline = Stopwatch.StartNew();
            bool empty = false;
            while (deadline.ElapsedMilliseconds < 10000) {
                uint message; UIntPtr key; IntPtr overlapped;
                uint remaining = (uint)Math.Max(1, 10000 - deadline.ElapsedMilliseconds);
                bool returned = GetQueuedCompletionStatus(port, out message, out key, out overlapped, remaining);
                int error = returned ? 0 : Marshal.GetLastWin32Error();
                Console.Error.WriteLine("NAVI_JOB_DIAGNOSTIC {\"operation\":\"GetQueuedCompletionStatus\",\"returned\":"
                    + (returned ? "true" : "false") + ",\"win32_error\":" + error + ",\"message\":" + message + "}");
                if (!returned) throw new Win32Exception(error);
                if (message == 4) { empty = true; break; } // ACTIVE_PROCESS_ZERO.
            }
            if (!empty) throw new TimeoutException("Job cleanup was not confirmed");
            // The bridge deliberately returns 1 when its server is terminated.
            // This wrapper's status certifies job cleanup, not backend success.
            return wait == 0 ? 0 : 124;
        } finally {
            if (process.Process != IntPtr.Zero && !assigned) TerminateProcess(process.Process, 1);
            if (job != IntPtr.Zero) CloseHandle(job);
            if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread);
            if (process.Process != IntPtr.Zero) CloseHandle(process.Process);
            if (port != IntPtr.Zero) CloseHandle(port);
        }
    }
}
'@
if ($CompileOnly) { Write-Output 'NAVI_JOB_COMPILE_PASS'; exit 0 }
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { exit 2 }
try {
    $data = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Request)) | ConvertFrom-Json
    exit [NaviKitJob]::Run([string]$data.executable, [string[]]$data.arguments, 600000)
} catch {
    $exception = $_.Exception
    while ($exception.InnerException) { $exception = $exception.InnerException }
    $errorRecord = @{
        exception_type = $exception.GetType().FullName
        message = $exception.Message
        hresult = $exception.HResult
    }
    if ($exception -is [System.ComponentModel.Win32Exception]) {
        $errorRecord.win32_error = $exception.NativeErrorCode
    }
    [Console]::Error.WriteLine('NAVI_JOB_EXCEPTION ' + ($errorRecord | ConvertTo-Json -Compress))
    [Console]::Error.WriteLine('NAVI_JOB_FAILED')
    exit 1
}
