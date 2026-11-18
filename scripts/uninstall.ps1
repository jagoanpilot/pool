$ErrorActionPreference = 'Continue'
$InstallDir = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { 'C:\phantomrider-pool' }
$ServiceName = 'phantomrider-pool'
Write-Host 'Menghentikan PhantomRider Pool...'
try { & node (Join-Path $InstallDir 'bin\pool.js') stop } catch {}
$winsw = Join-Path $InstallDir 'service\winsw.exe'
if (Test-Path $winsw) { try { & $winsw stop; & $winsw uninstall } catch {} }
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) { try { Stop-Service $ServiceName -Force; sc.exe delete $ServiceName | Out-Null } catch {} }
Write-Host "Data di $InstallDir tidak dihapus otomatis."
Write-Host 'Uninstall selesai.'
