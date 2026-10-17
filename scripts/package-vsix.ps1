$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$artifactName = 'vscode-browser-bridge.vsix'
$outPath = Join-Path $repoRoot $artifactName
$manifest = @'
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Id="vscode-browser-bridge" Version="0.1.0" Language="en-US" Publisher="NeeharArora" />
    <DisplayName>VS Code Browser Bridge</DisplayName>
    <Description>A local Windows named-pipe bridge to Copilot-backed models.</Description>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" />
  </Assets>
</PackageManifest>
'@

$extensionDir = Join-Path $repoRoot '.vsix-staging'
if (Test-Path $extensionDir) { Remove-Item $extensionDir -Recurse -Force }
New-Item -ItemType Directory -Path $extensionDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $extensionDir 'extension') | Out-Null

Copy-Item (Join-Path $repoRoot 'package.json') (Join-Path $extensionDir 'extension\package.json')
Set-Content -Path (Join-Path $extensionDir 'extension.vsixmanifest') -Value $manifest -Encoding UTF8
Set-Content -Path (Join-Path $extensionDir '[Content_Types].xml') -Value @'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/extension.vsixmanifest" ContentType="application/vnd.code.vsixmanifest+xml"/>
  <Override PartName="/extension/package.json" ContentType="application/json"/>
</Types>
'@ -Encoding UTF8

Compress-Archive -Path (Join-Path $extensionDir '*') -DestinationPath $outPath -Force
Remove-Item $extensionDir -Recurse -Force

Write-Host "Created $outPath"
