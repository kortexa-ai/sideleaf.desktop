param(
  [Parameter(Mandatory=$true)][string]$Package,
  [string[]]$Distribution = @(),
  [switch]$ListWsl,
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$archive = (Resolve-Path -LiteralPath $Package).Path
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source
$npmEntry = Join-Path (Split-Path $npm) 'node_modules/npm/bin/npm-cli.js'
if (!(Test-Path -LiteralPath $npmEntry)) { throw 'Use the standard Node.js Windows distribution with npm.' }
& node -e 'if (parseInt(process.versions.node) < 24) process.exit(1)'
if ($LASTEXITCODE -ne 0) { throw 'Install Node.js 24+ first.' }
if ($Uninstall) { & $node $npmEntry uninstall --global sideleaf-desktop } else { & $node $npmEntry install --global $archive }
if ($LASTEXITCODE -ne 0) { throw 'Native CLI installation failed.' }
$prefix = (& $node $npmEntry prefix --global).Trim()
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
  # Resolve a login-shell Node installation, then pass paths as native arguments.
  $operation = if ($Uninstall) { 'uninstall' } else { 'install' }
  $target = if ($Uninstall) { 'sideleaf-desktop' } else { $linuxPath }
  $nodePath = (& $wsl.Source -d $distro -- bash -lc 'command -v node').Trim()
  $npmPath = (& $wsl.Source -d $distro -- bash -lc 'command -v npm').Trim()
  if (!$nodePath.StartsWith('/') -or !$npmPath.StartsWith('/')) { throw "Install Linux Node.js 24+ and npm in $distro first." }
  $version = (& $wsl.Source -d $distro -- $nodePath --version).Trim()
  if ($version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 24) { throw "Node.js 24+ is required in $distro." }
  $binPath = $nodePath.Substring(0, $nodePath.LastIndexOf('/'))
  & $wsl.Source -d $distro -- env "PATH=${binPath}:/usr/local/bin:/usr/bin:/bin" $nodePath $npmPath $operation --global $target
  if ($LASTEXITCODE -ne 0) { throw "CLI setup failed in $distro. Install Linux Node.js 24+ and npm there, then rerun." }
}
Write-Output 'CLI setup complete. Open a new terminal if PATH was updated.'
