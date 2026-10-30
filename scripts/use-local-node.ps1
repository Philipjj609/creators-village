# Dot-source this file in the repository: . .\scripts\use-local-node.ps1
$taskNodeDirectory = Join-Path $PSScriptRoot '..\.local\tools\node-v24.22.1-win-x64'
if (-not (Test-Path -LiteralPath (Join-Path $taskNodeDirectory 'node.exe'))) {
  throw 'Approved local Node archive has not been installed. Follow INSTALL-01.'
}
$env:PATH = (Resolve-Path -LiteralPath $taskNodeDirectory).Path + ';' + $env:PATH
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $PSScriptRoot '..\.local\playwright'
