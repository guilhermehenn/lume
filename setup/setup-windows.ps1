#Requires -Version 5.1
<#
.SYNOPSIS
    Configura o ambiente completo do projeto no Windows 10/11.

.DESCRIPTION
    Instala o que faltar e prepara o projeto para rodar:
      - Git (versionamento)            via winget, fonte oficial
      - uv (gerenciador do Python)     via winget ou instalador oficial da Astral
      - Python 3.13                    via uv (isolado, não mexe em outros Pythons)
      - Node.js LTS (front-end)        via winget, fonte oficial
      - interface (front-end)          npm install, testes e compilação
      - dependências do back-end       uv sync com versões travadas (uv.lock)
      - banco SQLite local + backup    python -m app.cli setup
      - testes automáticos e verificação final

    Pode rodar quantas vezes quiser: o que já está instalado é mantido.
    Não altera configurações de segurança do Windows. A política de execução do
    PowerShell é liberada só para este processo (pelo .bat), não para o sistema.

.PARAMETER InstalarVSCode
    Também instala o Visual Studio Code.

.PARAMETER PularTestes
    Não roda os testes automáticos no final.

.PARAMETER SemFerramentas
    Não instala programas; só prepara o projeto (exige o uv já instalado).

.EXAMPLE
    configurar-windows.bat
    configurar-windows.bat -InstalarVSCode
#>
[CmdletBinding()]
param(
    [switch]$InstalarVSCode,
    [switch]$PularTestes,
    [switch]$SemFerramentas
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$global:LASTEXITCODE = 0

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUNBUFFERED = '1'

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------
$PythonVersion = '3.13'
$MinUvVersion = [version]'0.5.0'
$MinNodeMajor = 22
$MinFreeGB = 2

$Root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$Backend = Join-Path $Root 'backend'
$Frontend = Join-Path $Root 'frontend'
$LogDir = Join-Path $Root 'setup\logs'
$LogFile = Join-Path $LogDir ('setup-windows_{0}.log' -f (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'))
$script:Warnings = New-Object System.Collections.Generic.List[string]

# ---------------------------------------------------------------------------
# Saída na tela
# ---------------------------------------------------------------------------
function Write-Step([string]$Text) {
    Write-Host ''
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Write-Ok([string]$Text) { Write-Host "    [ok] $Text" -ForegroundColor Green }

function Write-Info([string]$Text) { Write-Host "    $Text" }

function Write-Aviso([string]$Text) {
    Write-Host "    [aviso] $Text" -ForegroundColor Yellow
    $script:Warnings.Add($Text)
}

# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------
function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Update-SessionPath {
    # Programas recém-instalados atualizam o PATH do registro, não o desta janela.
    $parts = New-Object System.Collections.Generic.List[string]
    $sources = @(
        [Environment]::GetEnvironmentVariable('Path', 'Machine'),
        [Environment]::GetEnvironmentVariable('Path', 'User'),
        $env:Path
    )
    foreach ($source in $sources) {
        if (-not $source) { continue }
        foreach ($entry in $source.Split(';')) {
            $clean = $entry.Trim()
            if ($clean -and -not $parts.Contains($clean)) { $parts.Add($clean) }
        }
    }
    $known = @(
        (Join-Path $env:USERPROFILE '.local\bin'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links'),
        (Join-Path $env:ProgramFiles 'nodejs'),
        (Join-Path $env:ProgramFiles 'Git\cmd')
    )
    foreach ($candidate in $known) {
        if ((Test-Path -LiteralPath $candidate) -and -not $parts.Contains($candidate)) {
            $parts.Add($candidate)
        }
    }
    $env:Path = [string]::Join(';', $parts)
}

function Invoke-Native {
    # Roda um programa externo, mostra a saída (e grava no log) e falha se o código de saída não for aceito.
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [Parameter(Mandatory = $true)][string]$Description,
        [int[]]$AllowedExitCodes = @(0)
    )
    if (-not (Test-Command $FilePath)) {
        throw "$Description falhou: o comando '$FilePath' não foi encontrado."
    }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $FilePath @ArgumentList 2>&1 | ForEach-Object { Write-Host "      $_" }
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
    if ($AllowedExitCodes -notcontains $code) {
        throw "$Description falhou (código de saída $code). Veja as mensagens acima."
    }
}

function Get-NativeOutput {
    param([string]$FilePath, [string[]]$ArgumentList = @())
    if (-not (Test-Command $FilePath)) { return '' }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $text = (& $FilePath @ArgumentList 2>$null | Out-String)
    }
    catch {
        $text = ''
    }
    finally {
        $ErrorActionPreference = $previous
    }
    if ($null -eq $text) { return '' }
    return $text.Trim()
}

function Get-VersionFromText([string]$Text) {
    if ($Text -match '(\d+)\.(\d+)\.(\d+)') {
        return [version]('{0}.{1}.{2}' -f $Matches[1], $Matches[2], $Matches[3])
    }
    return $null
}

function Test-Url([string]$Url) {
    try {
        Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing -TimeoutSec 20 | Out-Null
        return $true
    }
    catch {
        return $false
    }
}

function Invoke-Winget {
    param([string]$Verb, [string]$Id, [string]$Name)
    Write-Info "winget $Verb $Name (fonte oficial winget, ID $Id)..."
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & winget $Verb --id $Id --exact --source winget --accept-package-agreements --accept-source-agreements --silent 2>&1 |
            ForEach-Object { Write-Host "      $_" }
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
    if ($code -ne 0) { Write-Info "O winget terminou com o código $code." }
    Update-SessionPath
}

function Get-NodeMajor {
    $version = Get-VersionFromText (Get-NativeOutput -FilePath 'node' -ArgumentList @('--version'))
    if ($null -eq $version) { return 0 }
    return $version.Major
}

# ---------------------------------------------------------------------------
# Etapas
# ---------------------------------------------------------------------------
function Test-Prerequisites {
    Write-Step 'Verificando o sistema'

    if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
        throw 'O PowerShell está em modo restrito (política da empresa). Peça liberação ao suporte de TI.'
    }

    $os = [Environment]::OSVersion.Version
    if ($os.Major -lt 10 -or $os.Build -lt 17763) {
        throw "É preciso o Windows 10 versão 1809 ou mais novo, ou o Windows 11 (encontrado: build $($os.Build))."
    }
    if (-not [Environment]::Is64BitOperatingSystem) {
        throw 'É preciso um Windows de 64 bits.'
    }
    $edition = 'Windows 10'
    if ($os.Build -ge 22000) { $edition = 'Windows 11' }
    Write-Ok "$edition (build $($os.Build), $env:PROCESSOR_ARCHITECTURE)"

    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Info 'Rodando como administrador. Não é necessário: o Windows pede permissão quando precisar.'
    }

    $item = Get-Item -LiteralPath $Root
    $drive = $item.PSDrive
    if ($null -ne $drive -and $null -ne $drive.Free) {
        $freeGB = [math]::Round($drive.Free / 1GB, 1)
        if ($freeGB -lt $MinFreeGB) {
            Write-Aviso "Pouco espaço livre em ${drive}: ($freeGB GB). Recomendado: $MinFreeGB GB ou mais."
        }
        else {
            Write-Ok "Espaço livre em ${drive}: $freeGB GB"
        }
    }

    if ($Root -match '(?i)onedrive|dropbox|google drive|icloud') {
        Write-Aviso 'O projeto está numa pasta sincronizada com a nuvem. Funciona, mas a sincronização de .venv e node_modules deixa tudo lento. Prefira algo como C:\Projetos\financas-app.'
    }

    $longPaths = Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name 'LongPathsEnabled' -ErrorAction SilentlyContinue
    $longPathsOn = ($null -ne $longPaths) -and ($longPaths.LongPathsEnabled -eq 1)
    if (-not $longPathsOn -and $Root.Length -gt 80) {
        Write-Aviso "O caminho do projeto é longo ($($Root.Length) caracteres) e o Windows não está com caminhos longos ativados. Se der erro de caminho, mova o projeto para uma pasta mais curta."
    }

    if (Test-Url 'https://pypi.org/simple/') {
        Write-Ok 'Internet ok (pypi.org)'
    }
    else {
        throw 'Sem acesso a https://pypi.org. Verifique a internet, o proxy ou o firewall e rode de novo.'
    }

    if (Test-Command 'winget') {
        Write-Ok ('winget ' + (Get-NativeOutput -FilePath 'winget' -ArgumentList @('--version')))
    }
    elseif (-not $SemFerramentas) {
        Write-Aviso 'winget não encontrado. Instale ou atualize o "Instalador de Aplicativo" (App Installer) pela Microsoft Store para instalar Git e Node.js automaticamente.'
    }
}

function Unblock-ProjectScripts {
    # Arquivos extraídos de um ZIP baixado ficam marcados como "vindos da internet".
    # Desbloqueia só os scripts deste projeto, para os próximos cliques não mostrarem alerta.
    Get-ChildItem -LiteralPath $Root -Recurse -Depth 2 -File -ErrorAction SilentlyContinue |
        Where-Object { @('.ps1', '.bat', '.cmd') -contains $_.Extension.ToLowerInvariant() } |
        Unblock-File -ErrorAction SilentlyContinue
}

function Install-Git {
    Write-Step 'Git'
    if (-not (Test-Command 'git') -and -not $SemFerramentas -and (Test-Command 'winget')) {
        Write-Info 'Pode aparecer uma janela pedindo permissão de administrador (UAC).'
        Invoke-Winget -Verb 'install' -Id 'Git.Git' -Name 'Git'
    }
    if (Test-Command 'git') {
        Write-Ok (Get-NativeOutput -FilePath 'git' -ArgumentList @('--version'))
    }
    else {
        Write-Aviso 'Git não instalado. Ele serve para versionar o código, não para rodar o app. Instale em https://git-scm.com/download/win e rode este script de novo.'
    }
}

function Install-Uv {
    Write-Step 'uv (gerenciador do Python)'
    if (-not (Test-Command 'uv') -and -not $SemFerramentas) {
        if (Test-Command 'winget') {
            Invoke-Winget -Verb 'install' -Id 'astral-sh.uv' -Name 'uv'
        }
        if (-not (Test-Command 'uv')) {
            Write-Info 'Usando o instalador oficial da Astral (https://astral.sh/uv)...'
            $installer = Join-Path $env:TEMP ('uv-install-{0}.ps1' -f [guid]::NewGuid())
            try {
                Invoke-WebRequest -Uri 'https://astral.sh/uv/install.ps1' -OutFile $installer -UseBasicParsing
                Invoke-Native -FilePath 'powershell.exe' -Description 'Instalador do uv' -ArgumentList @(
                    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $installer
                )
            }
            finally {
                Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
            }
            Update-SessionPath
        }
    }
    if (-not (Test-Command 'uv')) {
        throw 'O uv não ficou disponível. Feche esta janela, abra de novo e rode o script mais uma vez. Se persistir, instale em https://docs.astral.sh/uv/'
    }

    $version = Get-VersionFromText (Get-NativeOutput -FilePath 'uv' -ArgumentList @('--version'))
    if ($null -eq $version) { throw 'Não foi possível ler a versão do uv.' }
    if ($version -lt $MinUvVersion) {
        Write-Info "uv $version é antigo; atualizando..."
        $selfUpdateCode = 1
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & uv self update 2>&1 | ForEach-Object { Write-Host "      $_" }
            $selfUpdateCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previous
        }
        if ($selfUpdateCode -ne 0 -and (Test-Command 'winget')) {
            Invoke-Winget -Verb 'upgrade' -Id 'astral-sh.uv' -Name 'uv'
        }
        $version = Get-VersionFromText (Get-NativeOutput -FilePath 'uv' -ArgumentList @('--version'))
        if ($null -eq $version -or $version -lt $MinUvVersion) {
            throw "É preciso o uv $MinUvVersion ou mais novo. Atualize com: winget upgrade astral-sh.uv"
        }
    }
    Write-Ok "uv $version"
}

function Install-Node {
    Write-Step 'Node.js LTS (para o front-end)'
    $major = Get-NodeMajor
    if ($major -lt $MinNodeMajor -and -not $SemFerramentas -and (Test-Command 'winget')) {
        Write-Info 'Pode aparecer uma janela pedindo permissão de administrador (UAC).'
        if ($major -gt 0) {
            Invoke-Winget -Verb 'upgrade' -Id 'OpenJS.NodeJS.LTS' -Name 'Node.js LTS'
        }
        else {
            Invoke-Winget -Verb 'install' -Id 'OpenJS.NodeJS.LTS' -Name 'Node.js LTS'
        }
        $major = Get-NodeMajor
    }
    if ($major -ge $MinNodeMajor) {
        $nodeVersion = Get-NativeOutput -FilePath 'node' -ArgumentList @('--version')
        $npmVersion = Get-NativeOutput -FilePath 'npm.cmd' -ArgumentList @('--version')
        Write-Ok "Node.js $nodeVersion, npm $npmVersion"
    }
    else {
        Write-Aviso "Node.js $MinNodeMajor+ não encontrado. Ele só é necessário a partir do passo 2 (front-end). Instale a versão LTS em https://nodejs.org e rode este script de novo."
    }
}

function Install-VSCode {
    if (-not $InstalarVSCode) { return }
    Write-Step 'Visual Studio Code'
    if (-not (Test-Command 'code') -and (Test-Command 'winget')) {
        Invoke-Winget -Verb 'install' -Id 'Microsoft.VisualStudioCode' -Name 'Visual Studio Code'
    }
    if (Test-Command 'code') { Write-Ok 'Visual Studio Code instalado' }
    else { Write-Aviso 'Não consegui instalar o VS Code. Baixe em https://code.visualstudio.com' }
}

function Initialize-Backend {
    Write-Step "Python $PythonVersion (gerenciado pelo uv)"
    Invoke-Native -FilePath 'uv' -ArgumentList @('python', 'install', $PythonVersion) -Description "Instalação do Python $PythonVersion"
    Write-Ok ('Python em ' + (Get-NativeOutput -FilePath 'uv' -ArgumentList @('python', 'find', $PythonVersion)))

    Push-Location -LiteralPath $Backend
    try {
        Write-Step 'Dependências do back-end'
        Write-Info 'Conferindo o uv.lock (versões travadas)...'
        Invoke-Native -FilePath 'uv' -ArgumentList @('lock') -Description 'Atualização do uv.lock'
        Invoke-Native -FilePath 'uv' -ArgumentList @('sync', '--locked') -Description 'Instalação das dependências (uv sync)'
        Write-Ok 'Dependências instaladas em backend\.venv'

        Write-Step 'Banco de dados local e backup'
        Invoke-Native -FilePath 'uv' -ArgumentList @('run', '--frozen', 'python', '-m', 'app.cli', 'setup') -Description 'Preparação do banco'

        if (-not $PularTestes) {
            Write-Step 'Testes automáticos'
            Invoke-Native -FilePath 'uv' -ArgumentList @('run', '--frozen', 'pytest') -Description 'Testes automáticos'
            Write-Ok 'Todos os testes passaram'
        }

        Write-Step 'Verificação final'
        Invoke-Native -FilePath 'uv' -ArgumentList @('run', '--frozen', 'python', '-m', 'app.cli', 'doctor') -Description 'Verificação final'
    }
    finally {
        Pop-Location
    }
}

function Initialize-Frontend {
    $packageJson = Join-Path $Frontend 'package.json'
    if (-not (Test-Path -LiteralPath $packageJson)) {
        return
    }
    Write-Step 'Interface (front-end)'
    $dist = Join-Path $Frontend 'dist'
    $hasDist = Test-Path -LiteralPath (Join-Path $dist 'index.html')
    if (-not (Test-Command 'npm.cmd')) {
        if ($hasDist) {
            Write-Aviso 'npm não encontrado: usando a interface já compilada que veio no projeto.'
            return
        }
        throw 'npm não encontrado e não há interface compilada. Instale o Node.js LTS e rode este script de novo.'
    }

    $backup = Join-Path $Frontend 'dist.anterior'
    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
    if ($hasDist) { Copy-Item -LiteralPath $dist -Destination $backup -Recurse }

    Push-Location -LiteralPath $Frontend
    try {
        if (Test-Path -LiteralPath (Join-Path $Frontend 'package-lock.json')) {
            Invoke-Native -FilePath 'npm.cmd' -ArgumentList @('ci', '--no-audit', '--no-fund') -Description 'npm ci'
        }
        else {
            Invoke-Native -FilePath 'npm.cmd' -ArgumentList @('install', '--no-audit', '--no-fund') -Description 'npm install'
        }
        if (-not $PularTestes) {
            Invoke-Native -FilePath 'npm.cmd' -ArgumentList @('run', 'test:unit') -Description 'Testes do front-end'
            Write-Ok 'Testes do front-end passaram'
        }
        Invoke-Native -FilePath 'npm.cmd' -ArgumentList @('run', 'build') -Description 'Compilação do front-end'
        Write-Ok 'Interface compilada em frontend\dist'
    }
    catch {
        if (-not $hasDist) { throw }
        if (Test-Path -LiteralPath $dist) { Remove-Item -LiteralPath $dist -Recurse -Force }
        Copy-Item -LiteralPath $backup -Destination $dist -Recurse
        Write-Aviso "Front-end: $($_.Exception.Message) Mantive a interface já compilada que veio no projeto."
    }
    finally {
        Pop-Location
        if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
    }
}

function Show-Summary {
    Write-Host ''
    Write-Host '============================================================' -ForegroundColor Green
    Write-Host ' Ambiente pronto!' -ForegroundColor Green
    Write-Host '============================================================' -ForegroundColor Green
    Write-Host ' Para abrir o app: clique duas vezes em iniciar-windows.bat'
    Write-Host " Log desta configuração: $LogFile"
    if ($script:Warnings.Count -gt 0) {
        Write-Host ''
        Write-Host ' Avisos:' -ForegroundColor Yellow
        foreach ($warning in $script:Warnings) { Write-Host "  - $warning" -ForegroundColor Yellow }
    }
    Write-Host ''
}

function Invoke-Main {
    Write-Host ''
    Write-Host 'Configuração do ambiente (Windows)' -ForegroundColor Cyan
    Write-Host "Projeto: $Root"

    Test-Prerequisites
    Unblock-ProjectScripts
    Install-Git
    Install-Uv
    Install-Node
    Install-VSCode
    Initialize-Frontend
    Initialize-Backend
    Show-Summary
}

# ---------------------------------------------------------------------------
# Execução
# ---------------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$transcribing = $false
try {
    Start-Transcript -LiteralPath $LogFile -Force | Out-Null
    $transcribing = $true
}
catch { }

$exitCode = 0
try {
    Invoke-Main
}
catch {
    $exitCode = 1
    Write-Host ''
    Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Log completo: $LogFile" -ForegroundColor Red
}
finally {
    if ($transcribing) {
        try { Stop-Transcript | Out-Null } catch { }
    }
}
exit $exitCode
