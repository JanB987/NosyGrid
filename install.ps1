param(
    [Parameter(Mandatory=$true)][string]$VaultPath
)
$ErrorActionPreference = 'Stop'
$resolvedVault = (Resolve-Path -LiteralPath $VaultPath).Path
if (-not (Test-Path -LiteralPath (Join-Path $resolvedVault '.obsidian') -PathType Container)) {
    throw 'The destination must be an existing Obsidian vault with a .obsidian directory.'
}
$pluginPath = Join-Path $resolvedVault '.obsidian/plugins/nosygrid'
foreach ($file in @('main.js','manifest.json','styles.css')) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "dist/$file"))) { throw 'Run npm run build before installing.' }
}
New-Item -ItemType Directory -Path $pluginPath -Force | Out-Null
foreach ($file in @('main.js','manifest.json','styles.css')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "dist/$file") -Destination (Join-Path $pluginPath $file) -Force
}
Write-Output "Installed NosyGrid: $pluginPath"
Write-Output 'Restart Obsidian, then enable NosyGrid in Community plugins.'
