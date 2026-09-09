param(
  [Parameter(Mandatory=$true)][string]$Package,
  [string[]]$Distribution = @(),
  [switch]$ListWsl,
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$archive = (Resolve-Path -LiteralPath $Package).Path
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
& node -e 'if (+process.versions.node.split(".")[0] < 24) process.exit(1)'
if ($LASTEXITCODE -ne 0) { throw 'Install Node.js 24+ first.' }
if ($Uninstall) { & $npm uninstall --global sideleaf-desktop } else { & $npm install --global $archive }
if ($LASTEXITCODE -ne 0) { throw 'Native CLI installation failed.' }
$prefix = (& $npm prefix --global).Trim()
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (!$Uninstall -and @($userPath -split ';' | Where-Object { $_.TrimEnd('\') -ieq $prefix.TrimEnd('\') }).Count) {
  # Existing npm prefix remains shared with other npm commands on uninstall.
} elseif (!$Uninstall) {
  [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $prefix), 'User')
}
$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
$available = @()
if ($wsl) {
  $available = @((& $wsl.Source --list --quiet 2>$null) -replace "`0", '' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}
if ($ListWsl -or !$Distribution.Count) {
  Write-Output ('WSL distributions: ' + $(if ($available.Count) { $available -join ', ' } else { 'none; rerun with -Distribution after adding WSL' }))
}
foreach ($distro in $Distribution) {
  if ($distro -notin $available) { throw "WSL distribution is not installed: $distro" }
  $linuxPath = (& $wsl.Source -d $distro -- wslpath -u $archive).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Could not convert package path for $distro" }
  # Each distro owns its Linux Node/npm installation, including WSL-native files.
  # Login shell enables an existing nvm installation. No user text is shell code.
  $operation = if ($Uninstall) { 'uninstall' } else { 'install' }
  $target = if ($Uninstall) { 'sideleaf-desktop' } else { $linuxPath }
  & $wsl.Source -d $distro -- bash -lc 'node -e ''if (+process.versions.node.split(".")[0] < 24) process.exit(1)'' && npm "$1" --global "$2"' sideleaf-install $operation $target
  if ($LASTEXITCODE -ne 0) { throw "CLI setup failed in $distro. Install Linux Node.js 24+ and npm there, then rerun." }
}
Write-Output 'CLI setup complete. Open a new terminal if PATH was updated.'
