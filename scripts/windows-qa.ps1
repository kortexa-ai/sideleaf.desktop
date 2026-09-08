param(
  [Parameter(Mandatory=$true)][string]$RequestPath,
  [Parameter(Mandatory=$true)][string]$ResponsePath
)

# Run in the interactive Windows session through the Sideleaf-only QA task.
# Every target must belong to this checkout's app or one of its child processes.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SideleafQA {
  public delegate bool EnumWindowsProc(IntPtr window, IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr param);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
}
'@

$root = Split-Path -Parent $PSScriptRoot
$allowedRoot = [IO.Path]::GetFullPath((Join-Path $root 'tmp\qa')) + '\'
foreach ($path in @($RequestPath, $ResponsePath)) {
  if (![IO.Path]::GetFullPath($path).StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'QA paths must be inside this checkout tmp\qa directory.' }
}
$request = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$result = @{ requestId=$request.id; action=$request.action; ok=$false }

try {
  $binary = Join-Path $root 'build\dev-win-x64\Sideleaf-dev\bin\cottontail.exe'
  $app = @(Get-Process | Where-Object { $_.Path -eq $binary })
  if ($app.Count -ne 1) { throw 'Expected exactly one Sideleaf process from this checkout.' }
  if ($app[0].SessionId -ne (Get-Process -Id $PID).SessionId) { throw 'QA and Sideleaf must run in the same interactive session.' }
  $owned = [Collections.Generic.HashSet[int]]::new()
  [void]$owned.Add($app[0].Id)
  $processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId)
  do {
    $before = $owned.Count
    foreach ($process in $processes) {
      if ($owned.Contains([int]$process.ParentProcessId)) { [void]$owned.Add([int]$process.ProcessId) }
    }
  } while ($owned.Count -ne $before)

  $windows = [Collections.Generic.List[object]]::new()
  $callback = [SideleafQA+EnumWindowsProc]{ param($window, $unused)
    [uint32]$ownerId=0
    [void][SideleafQA]::GetWindowThreadProcessId($window,[ref]$ownerId)
    if ($owned.Contains([int]$ownerId) -and [SideleafQA]::IsWindowVisible($window)) {
      $element=[Windows.Automation.AutomationElement]::FromHandle($window)
      $windows.Add([pscustomobject]@{handle=$window; element=$element; processId=$ownerId; title=$element.Current.Name})
    }
    return $true
  }
  [void][SideleafQA]::EnumWindows($callback,[IntPtr]::Zero)
  $result.windows = @($windows | ForEach-Object { @{title=$_.title;processId=$_.processId;className=$_.element.Current.ClassName;width=$_.element.Current.BoundingRectangle.Width;height=$_.element.Current.BoundingRectangle.Height} })
  if (!$windows.Count) { throw 'No visible Sideleaf window found.' }
  $window = @(if ($null -ne $request.window) { $windows | Where-Object title -eq $request.window } else { $windows | Where-Object title -like '*Sideleaf*' })
  if ($window.Count -ne 1) { throw 'Window title is ambiguous. Inspect and specify an exact title.' }
  $window=$window[0]
  $elements = $window.element.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)

  function Find-Target {
    $matches = @($elements | Where-Object {
      (!$request.name -or $_.Current.Name -eq $request.name) -and
      (!$request.automationId -or $_.Current.AutomationId -eq $request.automationId) -and
      (!$request.controlType -or $_.Current.ControlType.ProgrammaticName -eq $request.controlType)
    })
    if ($matches.Count -ne 1) { throw "Target matched $($matches.Count) elements; require one exact target." }
    return $matches[0]
  }
  function Focus-Target($target) {
    [void][SideleafQA]::SetForegroundWindow($window.handle)
    $target.SetFocus()
    [uint32]$foregroundId=0
    [void][SideleafQA]::GetWindowThreadProcessId([SideleafQA]::GetForegroundWindow(),[ref]$foregroundId)
    if (!$owned.Contains([int]$foregroundId)) { throw 'Foreground window is not owned by Sideleaf; input aborted.' }
  }

  switch ($request.action) {
    'inspect' {
      $result.elements = @($elements | ForEach-Object {
        $entry=@{name=$_.Current.Name;automationId=$_.Current.AutomationId;controlType=$_.Current.ControlType.ProgrammaticName;enabled=$_.Current.IsEnabled;offscreen=$_.Current.IsOffscreen}
        $pattern=$null
        if ($_.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)) { $entry.value=$pattern.Current.Value; $entry.readOnly=$pattern.Current.IsReadOnly }
        $entry
      })
    }
    'invoke' { (Find-Target).GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke() }
    'setValue' { (Find-Target).GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).SetValue([string]$request.text) }
    'keys' {
      $target=if ($request.name -or $request.automationId) { Find-Target } else { $window.element }
      Focus-Target $target
      [Windows.Forms.SendKeys]::SendWait([string]$request.keys)
    }
    'paste' {
      $target=Find-Target
      Focus-Target $target
      $previous=[Windows.Forms.Clipboard]::GetDataObject()
      try {
        [Windows.Forms.Clipboard]::SetText([string]$request.text)
        [Windows.Forms.SendKeys]::SendWait('^v')
        Start-Sleep -Milliseconds 150
      } finally {
        if ($previous) { [Windows.Forms.Clipboard]::SetDataObject($previous,$true) }
        else { [Windows.Forms.Clipboard]::Clear() }
      }
    }
    'capture' {
      $bounds=$window.element.Current.BoundingRectangle
      $bitmap=[Drawing.Bitmap]::new([int]$bounds.Width,[int]$bounds.Height)
      $graphics=[Drawing.Graphics]::FromImage($bitmap)
      $dc=$graphics.GetHdc()
      try { if (![SideleafQA]::PrintWindow($window.handle,$dc,2)) { throw 'Window capture failed.' } }
      finally { $graphics.ReleaseHdc($dc); $graphics.Dispose() }
      try { $bitmap.Save((Join-Path $allowedRoot 'windows-window.png'),[Drawing.Imaging.ImageFormat]::Png) }
      finally { $bitmap.Dispose() }
      $result.image='windows-window.png'
    }
    default { throw 'Unsupported QA action.' }
  }
  $result.ok=$true
} catch { $result.error=$_.Exception.Message; $result.detail=$_.ScriptStackTrace }
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ResponsePath -Encoding UTF8
if (!$result.ok) { exit 1 }
