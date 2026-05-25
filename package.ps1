# ============================================================
# PyInstaller build script (onefile)
# Run from project root:  .\build.ps1
# ============================================================

# --- Edit per release ---
$AppName = "Watchtower"
$Version = "1.0.0"
# ------------------------

$BuildFolder = "${AppName}_v${Version}"
$OutDir = ".\dist\$BuildFolder"

# Clean previous build of THIS version
if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
if (Test-Path ".\build\$BuildFolder") { Remove-Item -Recurse -Force ".\build\$BuildFolder" }
if (Test-Path ".\$BuildFolder.spec") { Remove-Item -Force ".\$BuildFolder.spec" }

# Build single-file exe (with console)
pyinstaller `
    --onefile `
    --icon="icon.ico" `
    --name "$BuildFolder" `
    --distpath "$OutDir" `
    app.py

# No console version
# pyinstaller `
#     --onefile `
#     --windowed `
#     --icon="icon.ico" `
#     --name "$BuildFolder" `
#     --distpath "$OutDir" `
#     app.py

# Rename the exe to the stable app name
$ExePath = "$OutDir\$BuildFolder.exe"
if (Test-Path $ExePath) {
    Rename-Item -Path $ExePath -NewName "$AppName.exe"
}

# Copy frontend folder next to the exe
Copy-Item -Recurse -Force ".\frontend" "$OutDir\frontend"

Write-Host ""
Write-Host "Build complete: $BuildFolder" -ForegroundColor Green
Write-Host "Run: $OutDir\$AppName.exe" -ForegroundColor Green