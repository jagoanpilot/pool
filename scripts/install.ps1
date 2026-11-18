# PhantomRider Pool Installer (Windows)
# Jalankan PowerShell sebagai Administrator:
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\scripts\install.ps1

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$InstallDir = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { 'C:\phantomrider-pool' }
$ServiceName = 'phantomrider-pool'

function Write-Step($n,$t){ Write-Host "[${n}/13] $t" -ForegroundColor Cyan }
Write-Host '== PhantomRider Pool Installer (Windows) ==' -ForegroundColor Green

# 1) Windows version
Write-Step 1 'Memeriksa versi Windows'
$os = Get-CimInstance Win32_OperatingSystem
Write-Host "OS: $($os.Caption) $($os.Version)"

# 2) Check Node.js
Write-Step 2 'Memeriksa Node.js/npm'
$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) {
  Write-Host 'ERROR: Node.js (>=18) dan npm diperlukan. Instal dari https://nodejs.org/ lalu jalankan installer lagi.' -ForegroundColor Red
  exit 1
}
$nv = (& node -v)
Write-Host "Node: $nv npm: $(& npm -v)"
if ([int]($nv -replace '^v(\d+).*','$1') -lt 18) { Write-Host 'ERROR: Node.js >= 18 diperlukan.' -ForegroundColor Red; exit 1 }

# 3) Check build tools (cmake)
Write-Step 3 'Memeriksa compiler/CMake (untuk helper algoritma)'
$cmake = Get-Command cmake -ErrorAction SilentlyContinue
if (-not $cmake) { Write-Host 'Peringatan: cmake tidak ditemukan. Helper hashing PHR-256-YP tidak dapat dibangun otomatis. Instal Visual Studio Build Tools + CMake, lalu jalankan npm run build:algo.' -ForegroundColor Yellow }

# 4) Copy files
Write-Step 4 "Menyalin file ke $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
# robocopy for reliable copy
$rcArgs = @($Root, $InstallDir, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/XD', 'node_modules', 'build', '.git')
& robocopy @rcArgs | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copy gagal (robocopy code $LASTEXITCODE)" }

# 5) npm install
Write-Step 5 'npm install'
Push-Location $InstallDir
try { & npm install --omit=dev } catch { Write-Host "Peringatan: npm install gagal: $($_.Exception.Message)" -ForegroundColor Yellow }

# 6) Build algorithm helper
Write-Step 6 'Build algorithm helper (PHR-256-YP)'
if ($cmake) {
  try {
    Push-Location (Join-Path $InstallDir 'algorithm\phantomrider')
    & cmake -S . -B build
    & cmake --build build --config Release
    Pop-Location
  } catch {
    Write-Host "Peringatan: build helper gagal: $($_.Exception.Message)" -ForegroundColor Yellow
  }
} else {
  Write-Host 'Lewati build helper (cmake tidak ada).' -ForegroundColor Yellow
}

# 7) Data & config
Write-Step 7 'Menyiapkan direktori data dan konfigurasi'
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'data\database'), (Join-Path $InstallDir 'data\logs') | Out-Null
if (-not (Test-Path (Join-Path $InstallDir '.env'))) { Copy-Item (Join-Path $InstallDir '.env.example') (Join-Path $InstallDir '.env') -ErrorAction SilentlyContinue }

# 8) PATH / pool command wrapper
Write-Step 8 'Menyiapkan command pool'
$bin = Join-Path $InstallDir 'bin'
$machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
if ($machinePath -notlike "*${bin}*") {
  [Environment]::SetEnvironmentVariable('Path', $machinePath + ';' + $bin, 'Machine')
  $env:Path += ";$bin"
  Write-Host "Ditambahkan ke PATH: $bin"
}

# 9) Windows Service (WinSW if available or sc/nssm guidance)
Write-Step 9 'Menyiapkan Windows Service'
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
$winsw = Join-Path $InstallDir 'service\winsw.exe'
$winswXml = Join-Path $InstallDir 'service\phantomrider-pool.xml'
if (Test-Path $winsw) {
  try {
    if ($svc) { & $winsw stop; & $winsw uninstall }
    & $winsw install
  } catch { Write-Host "Peringatan: instalasi WinSW service gagal: $($_.Exception.Message)" -ForegroundColor Yellow }
} else {
  Write-Host "WinSW (winsw.exe) tidak ditemukan di service/. Service Windows belum otomatis terpasang." -ForegroundColor Yellow
  Write-Host "Opsi: unduh WinSW, letakkan sebagai service\winsw.exe, sesuaikan service\phantomrider-pool.xml, lalu jalankan: service\winsw.exe install" -ForegroundColor Yellow
  Write-Host "Atau jalankan manual: pool start" -ForegroundColor Yellow
}

# 10) Firewall hint (do not auto-open broadly)
Write-Step 10 'Catatan firewall'
Write-Host 'Jika diperlukan, buka port Stratum/Dashboard di Windows Firewall secara eksplisit. Jangan membuka RPC node ke internet.'

# 11) Start
Write-Step 11 'Menjalankan service/proses'
if (Test-Path $winsw) {
  try { & $winsw start } catch { Write-Host "Peringatan: gagal start service: $($_.Exception.Message)" -ForegroundColor Yellow }
} else {
  Write-Host 'Menjalankan pool di background (tanpa Windows Service)...'
  try { & node (Join-Path $InstallDir 'bin\pool.js') start } catch { Write-Host "Peringatan: gagal start: $($_.Exception.Message)" -ForegroundColor Yellow }
}

# 12) Health checks
Write-Step 12 'Pemeriksaan'
Start-Sleep -Seconds 2
try { & node (Join-Path $InstallDir 'bin\pool.js') status } catch { Write-Host "Status: $($_.Exception.Message)" }

# 13) Done
Write-Step 13 'Selesai'
Write-Host "Instalasi selesai di $InstallDir" -ForegroundColor Green
Write-Host 'Langkah berikutnya:' -ForegroundColor Green
Write-Host "  1. Edit $InstallDir\config\pool.yaml (dan .env untuk RPC_PASSWORD)"
Write-Host '  2. Isi mining.pool_script_hex sesuai chain PhantomRider'
Write-Host '  3. pool restart ; pool status'
Write-Host '  4. Buka dashboard di port yang dikonfigurasi'
Write-Host 'CATATAN: Validasi RPC/template/submitblock terhadap node PhantomRider nyata sebelum produksi.' -ForegroundColor Yellow
Pop-Location
