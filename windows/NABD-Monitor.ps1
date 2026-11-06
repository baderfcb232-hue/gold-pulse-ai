# NABD Phase 12: one read-only Demo monitor per restricted Windows user.
# The Enroll action stores ONLY a monitor token as Windows user-bound DPAPI
# ciphertext; Run retrieves it in that same user's Windows session.
# Do not pass broker passwords here. Do not run tasks as Administrator.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Enroll', 'Run')]
    [string]$Action,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')]
    [string]$AccountId,

    [string]$WorkerId,
    [string]$Login,
    [string]$Server,
    [string]$TerminalPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This operation requires Windows.' }

$profileFolder = Join-Path $env:LOCALAPPDATA ("NABD\mt5-monitor\" + $AccountId)
$secretPath = Join-Path $profileFolder 'worker-token.dpapi'

function Assert-NoReparse([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        $item = Get-Item -LiteralPath $Path -Force
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Refusing redirected Windows profile path.'
        }
    }
}

if ($Action -eq 'Enroll') {
    # Call interactively as the SAME dedicated non-admin Windows user that
    # will later run the matching scheduled monitor task.
    if (Test-Path -LiteralPath $secretPath) {
        throw 'Existing token. Rotate/revoke on NABD admin before re-enrolling; manual review required.'
    }
    New-Item -ItemType Directory -Path $profileFolder -Force | Out-Null
    Assert-NoReparse $profileFolder

    # Remove inherited access and grant only the current Windows identity and
    # LOCAL SYSTEM access. Domain administrators still control the machine.
    $owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $acl = [System.Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner([System.Security.Principal.NTAccount]::new($owner))
    foreach ($account in @($owner, 'NT AUTHORITY\SYSTEM')) {
        $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            $account, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'
        ))
    }
    Set-Acl -LiteralPath $profileFolder -AclObject $acl

    $value = Read-Host 'Paste the one-time NABD READ-ONLY worker token (hidden)' -AsSecureString
    if ($null -eq $value -or $value.Length -ne 43) {
        throw 'Invalid monitor token length; nothing stored.'
    }
    $cipher = ConvertFrom-SecureString -SecureString $value
    [System.IO.File]::WriteAllText($secretPath, $cipher, [System.Text.Encoding]::ASCII)
    $value.Dispose()
    Write-Output 'Read-only monitor token protected for this Windows identity.'
    return
}

if ($WorkerId -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' -or
    $Login -notmatch '^[1-9][0-9]{3,15}$' -or
    $Server -notmatch '^JustMarkets-Demo[0-9]{0,5}$' -or
    [string]::IsNullOrWhiteSpace($TerminalPath) -or
    [System.IO.Path]::GetFileName($TerminalPath).ToLowerInvariant() -ne 'terminal64.exe' -or
    -not [System.IO.Path]::IsPathRooted($TerminalPath) -or
    -not (Test-Path -LiteralPath $TerminalPath -PathType Leaf)) {
    throw 'Invalid or missing isolated JustMarkets Demo monitor configuration.'
}

Assert-NoReparse $profileFolder
Assert-NoReparse $secretPath
Assert-NoReparse (Split-Path -Parent $TerminalPath)
Assert-NoReparse $TerminalPath
if (-not (Test-Path -LiteralPath $secretPath -PathType Leaf)) {
    throw 'Monitor token is not enrolled under the running Windows identity.'
}
$monitorScript = Join-Path $PSScriptRoot 'nabd_mt5_readonly_monitor.py'
if (-not (Test-Path -LiteralPath $monitorScript -PathType Leaf)) {
    throw 'Read-only monitoring worker not found.'
}
$handle = [IntPtr]::Zero
try {
    $secure = Get-Content -LiteralPath $secretPath -Raw -Encoding ASCII | ConvertTo-SecureString
    $handle = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $plaintext = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($handle)
    if ($plaintext -cnotmatch '^[A-Za-z0-9_-]{43}$') { throw 'Invalid protected monitor token.' }
    $env:NABD_MONITOR_TOKEN = $plaintext
    $plaintext = $null
    $env:NABD_MONITOR_ACCOUNT_ID = $AccountId
    $env:NABD_MONITOR_WORKER_ID = $WorkerId
    $env:NABD_MONITOR_MT5_LOGIN = $Login
    $env:NABD_MONITOR_MT5_SERVER = $Server
    $env:NABD_MONITOR_TERMINAL_PATH = $TerminalPath
    # A separate scheduled task / restricted Windows user is required for
    # EACH account. No shared terminal, implicit default profile, or trading.
    & py -3 $monitorScript
    if ($LASTEXITCODE -ne 0) { throw 'Read-only Demo monitor exited with a nonzero code.' }
}
finally {
    if ($handle -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($handle)
    }
    Remove-Item Env:NABD_MONITOR_TOKEN -ErrorAction SilentlyContinue
    foreach ($variable in @(
        'NABD_MONITOR_ACCOUNT_ID', 'NABD_MONITOR_WORKER_ID',
        'NABD_MONITOR_MT5_LOGIN', 'NABD_MONITOR_MT5_SERVER',
        'NABD_MONITOR_TERMINAL_PATH'
    )) {
        Remove-Item ("Env:" + $variable) -ErrorAction SilentlyContinue
    }
}
