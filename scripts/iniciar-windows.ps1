#Requires -Version 5.1
# Sobe o app em http://127.0.0.1 e abre o navegador. Chamado pelo iniciar-windows.bat.
# Argumentos extras são repassados ao app, por exemplo:  iniciar-windows.bat --dev

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$env:PYTHONUTF8 = '1'
$env:PYTHONUNBUFFERED = '1'

$Root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$Backend = Join-Path $Root 'backend'
$AppArgs = @($args)

function Update-SessionPath {
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
    foreach ($candidate in @((Join-Path $env:USERPROFILE '.local\bin'), (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links'))) {
        if ((Test-Path -LiteralPath $candidate) -and -not $parts.Contains($candidate)) { $parts.Add($candidate) }
    }
    $env:Path = [string]::Join(';', $parts)
}

Update-SessionPath

if (-not (Get-Command 'uv' -ErrorAction SilentlyContinue)) {
    Write-Host 'O uv não foi encontrado. Rode primeiro o configurar-windows.bat.' -ForegroundColor Red
    exit 1
}
if (-not (Test-Path -LiteralPath (Join-Path $Backend '.venv')) -or -not (Test-Path -LiteralPath (Join-Path $Backend 'uv.lock'))) {
    Write-Host 'O ambiente ainda não foi configurado. Rode primeiro o configurar-windows.bat.' -ForegroundColor Red
    exit 1
}

try { $Host.UI.RawUI.WindowTitle = 'Lume (rodando) - feche esta janela para encerrar' } catch { }

Set-Location -LiteralPath $Backend
$ErrorActionPreference = 'Continue'
& uv run --frozen python -m app @AppArgs
exit $LASTEXITCODE
