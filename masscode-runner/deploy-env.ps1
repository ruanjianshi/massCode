# massCode Runner 环境部署器（Windows）
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Tools)
$ErrorActionPreference = 'Stop'
if (-not $Tools -or $Tools.Count -eq 0) { $Tools = @('python3', 'gcc', 'gpp', 'clangformat', 'npx') }

$packages = [System.Collections.Generic.HashSet[string]]::new()
$needBlack = $false
foreach ($tool in $Tools) {
  switch ($tool) {
    'node'       { [void]$packages.Add('OpenJS.NodeJS.LTS') }
    'npx'        { [void]$packages.Add('OpenJS.NodeJS.LTS') }
    'python3'    { [void]$packages.Add('Python.Python.3.12') }
    'gcc'        { [void]$packages.Add('MSYS2.MSYS2') }
    'gpp'        { [void]$packages.Add('MSYS2.MSYS2') }
    'clangformat'{ [void]$packages.Add('LLVM.LLVM') }
    'java'       { [void]$packages.Add('EclipseAdoptium.Temurin.21.JDK') }
    'ruby'       { [void]$packages.Add('RubyInstallerTeam.RubyWithDevKit.3.3') }
    'go'         { [void]$packages.Add('GoLang.Go') }
    'gofmt'      { [void]$packages.Add('GoLang.Go') }
    'black'      { $needBlack = $true }
    'bash'       { [void]$packages.Add('Git.Git') }
    'swift'      { Write-Host 'Swift Windows 工具链请从 swift.org 安装。' -ForegroundColor Yellow }
  }
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  throw '未找到 winget，请先从 Microsoft Store 安装“应用安装程序”。'
}
foreach ($id in $packages) {
  winget install --id $id --exact --accept-package-agreements --accept-source-agreements
}
if ($needBlack) {
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) { py -m pip install --user black } else { python -m pip install --user black }
}
Write-Host '部署命令执行完成。请回到环境检测面板重新检测。' -ForegroundColor Green
