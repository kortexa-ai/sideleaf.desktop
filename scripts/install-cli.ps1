param([Parameter(Mandatory=$true)][string]$AppBin, [switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$AppBin = [IO.Path]::GetFullPath($AppBin).TrimEnd('\')
if (-not $Uninstall -and -not (Test-Path -LiteralPath (Join-Path $AppBin 'sideleaf.exe'))) { throw 'The Sideleaf command is missing. Reinstall Sideleaf.' }
$previous = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @($previous -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ine $AppBin })
if (-not $Uninstall) { $parts = @($AppBin) + $parts }
[Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')
# Notify Explorer so newly opened terminals receive the changed user PATH.
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class SideleafEnvironment { [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, UIntPtr w, string l, uint f, uint t, out UIntPtr r); }'
$result = [UIntPtr]::Zero
[void][SideleafEnvironment]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
