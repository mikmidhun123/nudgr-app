<#
.SYNOPSIS
Installs the current Nudgr release on physical Android devices.
.EXAMPLE
install_app.bat
.EXAMPLE
install_app.bat -Build -Serial DEVICE_SERIAL
.EXAMPLE
install_app.bat -PrepareOnly
.EXAMPLE
install_app.bat "C:\path to\signed.apk" -Serial DEVICE_SERIAL -Launch
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)][string]$ApkPath,
    [string]$Serial,
    [switch]$Build,
    [switch]$PrepareOnly,
    [switch]$Launch
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $appRoot 'android'
$sdkRoots = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT,
    (Join-Path $env:LOCALAPPDATA 'Android\Sdk')) | Where-Object { $_ } | Select-Object -Unique

function Invoke-Native {
    param([string]$File, [string[]]$Arguments)
    # Windows PowerShell otherwise treats ordinary native stderr as an exception.
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $lines = @(& $File @Arguments 2>&1 | ForEach-Object { $_.ToString() })
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $oldPreference }
    return [pscustomobject]@{ Code = $code; Text = ($lines -join "`n") }
}

function Require-Success {
    param($Result, [string]$Operation)
    if ($Result.Code -ne 0) { throw "$Operation failed.`n$($Result.Text)" }
}

function Find-Adb {
    foreach ($sdk in $sdkRoots) {
        $path = Join-Path $sdk 'platform-tools\adb.exe'
        if (Test-Path -LiteralPath $path -PathType Leaf) { return $path }
    }
    $commands = @(Get-Command adb.exe -CommandType Application -ErrorAction SilentlyContinue)
    if ($commands.Count -gt 0) { return [string]$commands[0].Source }
    throw 'ADB not found. Install Android SDK Platform-Tools or set ANDROID_HOME.'
}

function Find-BuildTool {
    param([string]$Name)
    foreach ($sdk in $sdkRoots) {
        $folder = Join-Path $sdk 'build-tools'
        if (-not (Test-Path -LiteralPath $folder -PathType Container)) { continue }
        $versions = Get-ChildItem -LiteralPath $folder -Directory | Sort-Object {
            try { [version](($_.Name -split '-')[0]) } catch { [version]'0.0' }
        } -Descending
        foreach ($version in $versions) {
            $path = Join-Path $version.FullName $Name
            if (Test-Path -LiteralPath $path -PathType Leaf) { return $path }
        }
    }
    throw "Android build tool $Name not found. Install Android SDK Build-Tools."
}

function Get-Property {
    param([string]$Device, [string]$Name)
    $result = Invoke-Native $adb @('-s', $Device, 'shell', 'getprop', $Name)
    if ($result.Code -eq 0) { return $result.Text.Trim() }
    return ''
}

function Get-PhysicalDevices {
    $result = Invoke-Native $adb @('devices', '-l')
    Require-Success $result 'ADB device scan'
    foreach ($line in ($result.Text -split "`r?`n")) {
        if ($line -notmatch '^(\S+)\s+(device|unauthorized|offline)\b') { continue }
        $id = $Matches[1]; $state = $Matches[2]
        if ($id -like 'emulator-*') { continue }
        if ($state -ne 'device') {
            Write-Host "[INFO] $id is $state. Unlock the phone and allow USB debugging."
            continue
        }
        if ((Get-Property $id 'ro.kernel.qemu') -eq '1' -or
            (Get-Property $id 'ro.boot.qemu') -eq '1') { continue }
        $model = Get-Property $id 'ro.product.model'
        $api = Get-Property $id 'ro.build.version.sdk'
        if (-not $model -or $api -notmatch '^\d+$') {
            Write-Host "[WARN] Skipping $id because it did not respond to device queries."
            continue
        }
        [pscustomobject]@{ Serial = $id; Model = $model; Api = [int]$api }
    }
}

try {
    Write-Host '=== Nudgr physical Android device installer ==='
    $adb = Find-Adb
    # Also support an SDK selected through an adb.exe on PATH.
    $adbSdk = Split-Path -Parent (Split-Path -Parent $adb)
    $sdkRoots = @($sdkRoots) + @($adbSdk)
    Require-Success (Invoke-Native $adb @('start-server')) 'Starting ADB'

    if ($ApkPath -and $Build) { throw 'Choose an APK path or -Build, not both.' }
    $releaseDir = Join-Path $androidDir 'app\build\outputs\apk\release'
    $metadataPath = Join-Path $releaseDir 'output-metadata.json'
    $unsignedApkPath = Join-Path $releaseDir 'app-release-unsigned.apk'
    $sourceNewerThanApk = $false
    if (-not $ApkPath -and (Test-Path -LiteralPath $unsignedApkPath -PathType Leaf)) {
        $apkTime = (Get-Item -LiteralPath $unsignedApkPath).LastWriteTimeUtc
        $srcPaths = @((Join-Path $appRoot 'App.js'), (Join-Path $appRoot 'src'))
        $newerFile = Get-ChildItem -LiteralPath $srcPaths -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTimeUtc -gt $apkTime } |
            Select-Object -First 1
        if ($newerFile) {
            Write-Host "[INFO] Source code ($($newerFile.Name)) is newer than the last built APK; rebuilding release APK."
            $sourceNewerThanApk = $true
        }
    }
    if ($Build -or $sourceNewerThanApk -or (-not $ApkPath -and -not (Test-Path -LiteralPath $metadataPath))) {
        Write-Host '[INFO] Building the bundled release APK. Metro is not required.'
        Push-Location $androidDir
        try {
            & (Join-Path $androidDir 'gradlew.bat') ':app:assembleRelease' '--console=plain' '--max-workers=2'
            if ($LASTEXITCODE -ne 0) { throw 'Release build failed; no installation attempted.' }
        } finally { Pop-Location }
    }
    if (-not $ApkPath) {
        if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) {
            throw 'Release metadata is missing. Run install_app.bat -Build.'
        }
        $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
        $outputs = @($metadata.elements | Where-Object { $_.type -eq 'SINGLE' -and @($_.filters).Count -eq 0 })
        if ($metadata.applicationId -ne 'com.nudgr' -or $outputs.Count -ne 1) {
            throw 'Expected one universal Nudgr release APK in Gradle output metadata.'
        }
        $leaf = [string]$outputs[0].outputFile
        if ([IO.Path]::GetFileName($leaf) -ne $leaf) { throw 'Invalid APK path in release metadata.' }
        $ApkPath = Join-Path $releaseDir $leaf
    }
    if ([IO.Path]::GetExtension($ApkPath) -ne '.apk' -or
        -not (Test-Path -LiteralPath $ApkPath -PathType Leaf)) {
        throw "APK not found: $ApkPath. Use -Build or drag a signed .apk onto install_app.bat."
    }
    $ApkPath = (Resolve-Path -LiteralPath $ApkPath).Path
    if ((Split-Path -Leaf $ApkPath) -eq 'app-qa.apk') {
        throw 'The QA APK requires local emulator services. Use the default release for a physical phone.'
    }
    $signer = Find-BuildTool 'apksigner.bat'
    $aapt = Find-BuildTool 'aapt2.exe'
    $badging = Invoke-Native $aapt @('dump', 'badging', $ApkPath)
    Require-Success $badging 'Reading APK metadata'
    if ($badging.Text -notmatch "(?m)^package: name='com\.nudgr' versionCode='(\d+)' versionName='([^']+)'") {
        throw 'The selected APK is not the Nudgr application (com.nudgr).'
    }
    Write-Host "[INFO] Nudgr $($Matches[2]), version code $($Matches[1])"
    $minimumApi = 24
    if ($badging.Text -match "(?m)^(?:sdkVersion|minSdkVersion):'(\d+)'") { $minimumApi = [int]$Matches[1] }

    $verification = Invoke-Native $signer @('verify', $ApkPath)
    if ($verification.Code -ne 0) {
        if ((Split-Path -Leaf $ApkPath) -notlike '*-unsigned.apk') {
            throw "APK signature verification failed. Select a valid signed APK or the current unsigned release.`n$($verification.Text)"
        }
        $key = Join-Path $androidDir 'app\debug.keystore'
        if (-not (Test-Path -LiteralPath $key -PathType Leaf)) {
            throw 'The local Android debug keystore is missing. Configure the development keystore or select a signed APK.'
        }
        $aligner = Find-BuildTool 'zipalign.exe'
        $deviceDir = Join-Path $androidDir 'app\build\outputs\apk\device-test'
        [void](New-Item -ItemType Directory -Path $deviceDir -Force)
        $aligned = Join-Path $deviceDir 'nudgr-device-aligned.apk'
        $signed = Join-Path $deviceDir 'nudgr-device-test.apk'
        Write-Host '[INFO] Preparing a debug-key-signed phone test copy. Unsigned release stays unchanged.'
        try {
            Require-Success (Invoke-Native $aligner @('-f', '-P', '16', '4', $ApkPath, $aligned)) 'APK alignment'
            Require-Success (Invoke-Native $signer @('sign', '--ks', $key, '--ks-key-alias', 'androiddebugkey',
                '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', $signed, $aligned)) 'Signing test copy'
            Require-Success (Invoke-Native $signer @('verify', $signed)) 'Verifying test copy'
            Require-Success (Invoke-Native $aligner @('-c', '-P', '16', '4', $signed)) 'Verifying aligned test copy'
        } finally {
            if (Test-Path -LiteralPath $aligned -PathType Leaf) { Remove-Item -LiteralPath $aligned }
        }
        $ApkPath = $signed
        Write-Host '[INFO] Test certificate only; this is not a Play distribution artifact.'
    }
    Write-Host "[OK] Installable APK: $ApkPath"
    Write-Host '[NOTE] Backend/rules rollout is still pending; installing the app does not deploy those changes.'

    while ($true) {
        $devices = @(Get-PhysicalDevices)
        for ($i = 0; $i -lt $devices.Count; $i++) {
            Write-Host "[$($i + 1)] $($devices[$i].Model) - $($devices[$i].Serial) - API $($devices[$i].Api)"
        }
        if ($Serial) {
            $targets = @($devices | Where-Object { $_.Serial -eq $Serial })
            if ($targets.Count -ne 1) { throw "Physical device $Serial is not connected/authorized." }
            break
        }
        if ($PrepareOnly) { break }
        if ($devices.Count -eq 1) { $targets = $devices; break }
        if ($devices.Count -eq 0) {
            Write-Host 'Connect a USB phone, enable USB debugging, unlock it and accept the authorization prompt.'
        }
        $choice = Read-Host 'Choose a device number, A=all physical phones, R=rescan, W=wireless, Q=quit'
        if ($choice -ieq 'Q') { exit 0 }
        if ($choice -ieq 'W') {
            $address = Read-Host 'Paired wireless debugging address (HOST:PORT)'
            if ($address -match '^\S+:\d{1,5}$') {
                $connection = Invoke-Native $adb @('connect', $address)
                Write-Host $connection.Text
            } else { Write-Host '[WARN] Enter HOST:PORT. Pair new devices with adb pair first.' }
            continue
        }
        if ($choice -ieq 'A' -and $devices.Count -gt 0) { $targets = $devices; break }
        $number = 0
        if ([int]::TryParse($choice, [ref]$number) -and $number -ge 1 -and $number -le $devices.Count) {
            $targets = @($devices[$number - 1]); break
        }
    }
    if ($PrepareOnly) { Write-Host '[OK] Preparation complete. No app was installed or launched.'; exit 0 }
    $failures = 0
    foreach ($device in $targets) {
        if ($device.Api -lt $minimumApi) {
            Write-Host "[ERROR] $($device.Model) requires Android API $minimumApi or later."
            $failures++; continue
        }
        Write-Host "[INFO] Installing on $($device.Model) ($($device.Serial)); watch for a phone confirmation prompt."
        $result = Invoke-Native $adb @('-s', $device.Serial, 'install', '-r', $ApkPath)
        Write-Host $result.Text
        if ($result.Code -ne 0) {
            $failures++
            if ($result.Text -match 'INSTALL_FAILED_UPDATE_INCOMPATIBLE') {
                Write-Host '[ERROR] Signing key differs. Existing app/data were kept. Use an APK signed with the existing key.'
            } elseif ($result.Text -match 'INSTALL_FAILED_VERSION_DOWNGRADE') {
                Write-Host '[ERROR] A newer app is installed. Select a current build; downgrade was not forced.'
            }
            continue
        }
        Write-Host "[OK] Installed on $($device.Model). Existing app data retained."
        if ($Launch) {
            $started = Invoke-Native $adb @('-s', $device.Serial, 'shell', 'am', 'start', '-n', 'com.nudgr/.MainActivity')
            if ($started.Code -ne 0 -or $started.Text -match 'Error:') {
                Write-Host "[ERROR] Launch failed: $($started.Text)"; $failures++
            }
        } else { Write-Host 'Open Nudgr on your phone when ready.' }
    }
    if ($failures -gt 0) { exit 1 }
    exit 0
} catch {
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
