#Requires -Version 5.1
<#
.SYNOPSIS
    Action Packer Uninstallation Script for Windows

.DESCRIPTION
    Removes the Action Packer scheduled task and optionally cleans up files.

.EXAMPLE
    .\uninstall.ps1
#>

$ErrorActionPreference = "Stop"

# Colors and formatting
function Write-StatusMessage { param($Message) Write-Host "✓ " -ForegroundColor Green -NoNewline; Write-Host $Message }
function Write-WarningMessage { param($Message) Write-Host "⚠ " -ForegroundColor Yellow -NoNewline; Write-Host $Message }
function Write-ErrorMessage { param($Message) Write-Host "✗ " -ForegroundColor Red -NoNewline; Write-Host $Message }
function Write-InfoMessage { param($Message) Write-Host "ℹ " -ForegroundColor Cyan -NoNewline; Write-Host $Message }

# Script paths
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$TaskName = "ActionPacker"
$LogDir = Join-Path $env:LOCALAPPDATA "ActionPacker\Logs"

Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║            Action Packer Uninstallation Script             ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

Write-Host "Project directory: $ProjectDir"
Write-Host ""

# Confirm uninstallation
$Confirm = Read-Host "Are you sure you want to uninstall Action Packer? [y/N]"
if ($Confirm -notmatch '^[Yy]') {
    Write-InfoMessage "Uninstallation cancelled"
    exit 0
}

# Stop and remove the scheduled task
Write-Host ""
Write-Host "Removing Windows Task..." -ForegroundColor Cyan

$ExistingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($ExistingTask) {
    # Stop the task if running
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Write-StatusMessage "Task stopped"
    
    # Remove the task
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-StatusMessage "Task removed"
} else {
    Write-InfoMessage "Scheduled task not found (may not be installed)"
}

# Remove startup script
$StartupScript = Join-Path $ProjectDir "scripts\startup.ps1"
if (Test-Path $StartupScript) {
    Remove-Item $StartupScript -Force
    Write-StatusMessage "Removed startup script"
}

# Ask about logs
Write-Host ""
if (Test-Path $LogDir) {
    $RemoveLogs = Read-Host "Remove log files at $LogDir? [y/N]"
    if ($RemoveLogs -match '^[Yy]') {
        Remove-Item $LogDir -Recurse -Force
        # Try to remove parent ActionPacker folder if empty
        $ParentDir = Split-Path -Parent $LogDir
        if ((Test-Path $ParentDir) -and ((Get-ChildItem $ParentDir | Measure-Object).Count -eq 0)) {
            Remove-Item $ParentDir -Force
        }
        Write-StatusMessage "Removed log directory"
    } else {
        Write-InfoMessage "Log files preserved"
    }
}

# Ask about node_modules and build files
Write-Host ""
$RemoveNodeModules = Read-Host "Remove node_modules and build files? [y/N]"
if ($RemoveNodeModules -match '^[Yy]') {
    $Paths = @(
        (Join-Path $ProjectDir "node_modules"),
        (Join-Path $ProjectDir "backend\node_modules"),
        (Join-Path $ProjectDir "frontend\node_modules"),
        (Join-Path $ProjectDir "backend\dist"),
        (Join-Path $ProjectDir "frontend\dist")
    )
    foreach ($Path in $Paths) {
        if (Test-Path $Path) {
            Remove-Item $Path -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    Write-StatusMessage "Removed node_modules and build files"
} else {
    Write-InfoMessage "Files preserved"
}

# Ask about data files
Write-Host ""
$DataDir = Join-Path $ProjectDir "backend\data"
if (Test-Path $DataDir) {
    $RemoveData = Read-Host "Remove database and data files? [y/N]"
    if ($RemoveData -match '^[Yy]') {
        Remove-Item $DataDir -Recurse -Force
        Write-StatusMessage "Removed data directory"
    } else {
        Write-InfoMessage "Data files preserved"
    }
}

# Ask about .env file
Write-Host ""
$EnvFile = Join-Path $ProjectDir "backend\.env"
if (Test-Path $EnvFile) {
    $RemoveEnv = Read-Host "Remove environment configuration (.env)? [y/N]"
    if ($RemoveEnv -match '^[Yy]') {
        Remove-Item $EnvFile -Force
        Write-StatusMessage "Removed .env file"
    } else {
        Write-InfoMessage "Environment file preserved"
    }
}

Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║            Uninstallation Complete! 👋                     ║" -ForegroundColor Green
Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-InfoMessage "Action Packer service has been removed."
Write-InfoMessage "The project files remain in: $ProjectDir"
Write-Host ""
