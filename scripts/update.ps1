$ErrorActionPreference = 'Continue'
$InstallDir = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { 'C:\phantomrider-pool' }
Set-Location $InstallDir
if (Get-Command git -ErrorAction SilentlyContinue) { try { git pull --ff-only } catch {} }
& npm install --omit=dev
if (Get-Command cmake -ErrorAction SilentlyContinue) {
  try { Push-Location (Join-Path $InstallDir 'algorithm\phantomrider'); & cmake -S . -B build; & cmake --build build --config Release; Pop-Location } catch { Write-Host "Build algo gagal: $($_.Exception.Message)" -ForegroundColor Yellow }
}
try { & node (Join-Path $InstallDir 'bin\pool.js') restart } catch { Write-Host 'Restart manual diperlukan.' -ForegroundColor Yellow }
& node (Join-Path $InstallDir 'bin\pool.js') status
