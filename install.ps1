# Installation locale de Cartoff (Windows).
# Prérequis vérifiés puis installés : Python 3.10+, go-pmtiles, fond Loire reconstitué.
# L'altitude Copernicus de la Loire est produite à la fin.
# -WithElevation reste accepté : l'altitude est toujours installée.
param(
    [switch]$WithElevation
)

[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$OutputEncoding = [Console]::OutputEncoding
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$PmtilesVersion = "1.31.2"
$PythonMin = [version]"3.10"

function Write-Step([string]$Message) {
    Write-Host "[Cartoff] $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "[Cartoff] $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
    Write-Host "[Cartoff] $Message" -ForegroundColor Yellow
}

function Fail([string]$Message) {
    Write-Host "[Cartoff] ERREUR: $Message" -ForegroundColor Red
    exit 1
}

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
}

function Test-PythonVersion([string]$Exe, [string[]]$PrefixArgs) {
    $code = "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"
    & $Exe @PrefixArgs -c $code 2>$null
    return $LASTEXITCODE -eq 0
}

function Find-Python {
    $known = @(
        @{ Exe = "py"; Args = @("-3") },
        @{ Exe = "python"; Args = @() },
        @{ Exe = "python3"; Args = @() }
    )
    foreach ($candidate in $known) {
        if (-not (Get-Command $candidate.Exe -ErrorAction SilentlyContinue)) { continue }
        if (Test-PythonVersion $candidate.Exe $candidate.Args) {
            return $candidate
        }
    }
    $roots = @(
        "$env:LocalAppData\Programs\Python",
        "$env:ProgramFiles\Python312",
        "$env:ProgramFiles\Python313",
        "${env:ProgramFiles(x86)}\Python312"
    )
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }
        $exes = Get-ChildItem -Path $root -Filter python.exe -Recurse -ErrorAction SilentlyContinue
        foreach ($exe in $exes) {
            if (Test-PythonVersion $exe.FullName @()) {
                return @{ Exe = $exe.FullName; Args = @() }
            }
        }
    }
    return $null
}

function Install-Python {
    Write-Step "Python 3.10+ absent. Installation via winget (Python 3.12)..."
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        Fail "winget est absent. Installez Python 3.12 depuis https://www.python.org/downloads/ puis relancez install.bat."
    }
    & winget install --id Python.Python.3.12 -e --scope user --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "winget a renvoyé le code $LASTEXITCODE. Nouvelle recherche de Python..."
    }
    Refresh-Path
}

function Get-GoPmtilesAsset {
    $arch = $env:PROCESSOR_ARCHITECTURE
    if ($arch -eq "ARM64") { return "Windows_arm64" }
    if ($arch -eq "AMD64") { return "Windows_x86_64" }
    Fail "Architecture non prise en charge : $arch. Il faut Windows 64 bits."
}

function Install-GoPmtiles {
    $destDir = Join-Path $Root "pmtiles\tools"
    $dest = Join-Path $destDir "pmtiles.exe"
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    if (Test-Path $dest) {
        & $dest --help *> $null
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "go-pmtiles déjà présent : $dest"
            return
        }
        Write-Warn "pmtiles.exe présent mais inutilisable. Nouveau téléchargement."
    }
    $asset = Get-GoPmtilesAsset
    $url = "https://github.com/protomaps/go-pmtiles/releases/download/v$PmtilesVersion/go-pmtiles_${PmtilesVersion}_${asset}.zip"
    $tmp = Join-Path $env:TEMP "go-pmtiles-$PmtilesVersion"
    $zip = Join-Path $env:TEMP "go-pmtiles-$PmtilesVersion.zip"
    Write-Step "Téléchargement de go-pmtiles $PmtilesVersion ($asset)..."
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $found = Get-ChildItem -Path $tmp -Filter pmtiles.exe -Recurse | Select-Object -First 1
    if (-not $found) { Fail "pmtiles.exe introuvable dans l'archive $url" }
    Copy-Item -Force $found.FullName $dest
    Remove-Item -Force $zip -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    & $dest --help *> $null
    if ($LASTEXITCODE -ne 0) { Fail "pmtiles.exe téléchargé mais l'exécution a échoué." }
    Write-Ok "go-pmtiles installé : $dest"
}

function Install-LoireBasemap {
    $archive = Join-Path $Root "pmtiles\loire.pmtiles"
    $manifest = Join-Path $Root "pmtiles\loire.pmtiles.manifest.json"
    if (Test-Path $archive) {
        Write-Ok "Fond Loire déjà présent : pmtiles\loire.pmtiles"
        return
    }
    if (-not (Test-Path $manifest)) {
        Fail "Manifeste absent. Le clone est incomplet (pmtiles/loire.pmtiles.part00N)."
    }
    Write-Step "Reconstitution de loire.pmtiles à partir des morceaux versionnés..."
    & $script:PythonExe @script:PythonArgs "scripts\unpack_large_file.py"
    if ($LASTEXITCODE -ne 0) { Fail "La reconstitution de loire.pmtiles a échoué." }
    if (-not (Test-Path $archive)) { Fail "loire.pmtiles n'a pas été créé." }
    Write-Ok "Fond Loire prêt."
}

function Install-Elevation {
    $bin = Join-Path $Root "elevation\loire_elev.bin"
    if (Test-Path $bin) {
        Write-Ok "Altitude déjà présente : elevation\loire_elev.bin"
        return
    }
    Write-Step "Installation de rasterio, numpy et shapely, puis génération du MNT Loire..."
    & $script:PythonExe @script:PythonArgs -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) { Fail "pip n'a pas pu être mis à jour." }
    & $script:PythonExe @script:PythonArgs -m pip install rasterio numpy shapely
    if ($LASTEXITCODE -ne 0) { Fail "Installation des paquets d'altitude impossible." }
    & $script:PythonExe @script:PythonArgs "scripts\build_elevation_loire.py"
    if ($LASTEXITCODE -ne 0) { Fail "La génération de l'altitude a échoué." }
    Write-Ok "Altitude Loire prête."
}

function Test-LocalData {
    $communes = Join-Path $Root "geojson\D42\communes_contours_osm_42.geojson"
    $dfci = Join-Path $Root "geojson\D42\dfci_100km_42.geojson"
    if (-not (Test-Path $communes) -or -not (Test-Path $dfci)) {
        Fail "Calques Loire absents dans geojson\D42. Le clone est incomplet."
    }
    & $script:PythonExe @script:PythonArgs -c "import extract, zone_layers, serve"
    if ($LASTEXITCODE -ne 0) { Fail "Les modules Python de Cartoff ne se chargent pas." }
    Write-Ok "Calques du département 42 et serveur prêts."
}

Write-Host ""
Write-Step "Installation locale de Cartoff"
Write-Step "Dossier : $Root"

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$python = Find-Python
if (-not $python) {
    Install-Python
    $python = Find-Python
}
if (-not $python) {
    Fail "Python 3.10+ introuvable après installation. Ouvrez un nouveau terminal et relancez install.bat."
}
$script:PythonExe = $python.Exe
$script:PythonArgs = $python.Args
$shown = & $script:PythonExe @script:PythonArgs -c "import sys; print(sys.version.split()[0])"
Write-Ok "Python $shown ($($script:PythonExe))"

Install-GoPmtiles
Install-LoireBasemap
Test-LocalData

if ($WithElevation) {
    Write-Step "Altitude demandée explicitement : elle fait déjà partie de l'installation."
}
Install-Elevation

Write-Host ""
Write-Ok "Cartoff est prêt en local."
Write-Host "[Cartoff] Lancez start.bat puis ouvrez http://localhost:8000/"
Write-Host "[Cartoff] La carte, les calques et les missions fonctionnent sans réseau."
Write-Host "[Cartoff] Extraire une nouvelle zone demande Internet le temps du téléchargement."
Write-Host ""
