param(
  [ValidatePattern('^[a-z0-9-]+$')][string]$Label = 'baseline',
  [string[]]$RuntimeArguments = @(),
  [switch]$SampleThread
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$binary = Join-Path $root 'build\dev-win-x64\Sideleaf-dev\bin\cottontail.exe'
$directory = Join-Path $root 'tmp\qa'
New-Item -ItemType Directory -Force $directory | Out-Null
$prefix = Join-Path $directory "idle-$Label"
if (Get-Process cottontail -ErrorAction SilentlyContinue | Where-Object Path -EQ $binary) {
  throw 'Close the Sideleaf app or previous probe before starting an isolated measurement.'
}
if ($SampleThread) {
  # Sample only the process that this script starts. Each brief suspension is
  # paired with ResumeThread in finally; no global ETW recording is used.
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
public static class SideleafIdleThread {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenThread(uint access, bool inherit, uint id);
  [DllImport("kernel32.dll")] static extern uint GetProcessIdOfThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint SuspendThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetThreadContext(IntPtr thread, IntPtr context);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static Dictionary<string,int> Sample(uint processId, uint threadId) {
    var samples = new Dictionary<string,int>();
    IntPtr thread = OpenThread(0x4a, false, threadId);
    if (thread == IntPtr.Zero) throw new InvalidOperationException("Cannot open probe thread");
    IntPtr storage = Marshal.AllocHGlobal(1248);
    IntPtr context = new IntPtr((storage.ToInt64() + 15) & ~15L);
    try {
      if (GetProcessIdOfThread(thread) != processId) throw new InvalidOperationException("Probe thread ownership changed");
      for (int i=0; i<200; i++) {
        Marshal.WriteInt32(context, 48, 0x100001); // AMD64 control registers.
        if (SuspendThread(thread) == UInt32.MaxValue) throw new InvalidOperationException("Cannot suspend probe thread");
        try {
          if (!GetThreadContext(thread, context)) throw new InvalidOperationException("Cannot read probe context");
          string address = unchecked((ulong)Marshal.ReadInt64(context, 248)).ToString("x");
          if (!samples.ContainsKey(address)) samples[address] = 0;
          samples[address]++;
        } finally {
          if (ResumeThread(thread) == UInt32.MaxValue) throw new InvalidOperationException("Cannot resume probe thread");
        }
        Thread.Sleep(10);
      }
    } finally {
      Marshal.FreeHGlobal(storage);
      CloseHandle(thread);
    }
    return samples;
  }
}
'@
}
$arguments = @($RuntimeArguments) + @('scripts/benchmark-idle.ts')
$probe = Start-Process -FilePath $binary -ArgumentList $arguments -WorkingDirectory $root -NoNewWindow -PassThru -RedirectStandardOutput "$prefix.jsonl" -RedirectStandardError "$prefix.err"
# Retain the handle before exit so Windows PowerShell can read the exit code.
$probeHandle = $probe.Handle
Start-Sleep -Seconds 5
$probe.Refresh()
if ($probe.HasExited) { Get-Content "$prefix.err"; throw 'Probe exited before measurement' }
$cpu = $probe.TotalProcessorTime.TotalSeconds
$userCpu = $probe.UserProcessorTime.TotalSeconds
$kernelCpu = $probe.PrivilegedProcessorTime.TotalSeconds
$clock = [Diagnostics.Stopwatch]::StartNew()
Start-Sleep -Seconds 10
$probe.Refresh()
$result = [ordered]@{
  pid = $probe.Id
  wallSeconds = $clock.Elapsed.TotalSeconds
  cpuSeconds = $probe.TotalProcessorTime.TotalSeconds - $cpu
  userSeconds = $probe.UserProcessorTime.TotalSeconds - $userCpu
  kernelSeconds = $probe.PrivilegedProcessorTime.TotalSeconds - $kernelCpu
  workingSet = $probe.WorkingSet64
  privateBytes = $probe.PrivateMemorySize64
}
$result | ConvertTo-Json | Tee-Object "$prefix-cpu.json"
if ($SampleThread) {
  $thread = $probe.Threads | Sort-Object {$_.TotalProcessorTime.TotalSeconds} -Descending | Select-Object -First 1
  $modules = $probe.Modules | ForEach-Object { @{name=$_.ModuleName; start=$_.BaseAddress.ToInt64().ToString('x'); size=$_.ModuleMemorySize} }
  @{threadId=$thread.Id; modules=$modules; samples=[SideleafIdleThread]::Sample($probe.Id,$thread.Id)} | ConvertTo-Json -Depth 5 | Set-Content "$prefix-samples.json"
}
if (!$probe.WaitForExit(15000)) { throw 'Probe did not finish on schedule' }
Get-Content "$prefix.err"
Get-Content "$prefix.jsonl"
if ($probe.ExitCode -ne 0) { throw "Probe failed with exit code $($probe.ExitCode)" }
