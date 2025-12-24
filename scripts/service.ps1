#Requires -Version 5.1
<#
.SYNOPSIS
    Action Packer Service Control Script for Windows

.DESCRIPTION
    Provides commands to manage the Action Packer service (start, stop, restart, status, logs).

.PARAMETER Command
    The command to execute: start, stop, restart, status, logs

.EXAMPLE
    .\service.ps1 status
    .\service.ps1 start
    .\service.ps1 stop
    .\service.ps1 restart
    .\service.ps1 logs
#>

param(
    [Parameter(Position=0)]
    [ValidateSet("start", "stop", "restart", "status", "logs", "help")]
    [string]$Command = "help"
)

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

function Test-TaskInstalled {
    $Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $Task) {
        Write-ErrorMessage "Service is not installed. Run install.ps1 first."
        exit 1
    }
    return $Task
}

function Start-ActionPacker {
    $Task = Test-TaskInstalled
    Write-Host "Starting Action Packer..." -ForegroundColor Cyan
    
    if ($Task.State -eq "Running") {
        Write-InfoMessage "Service is already running"
        return
    }
    
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 2
    Write-StatusMessage "Service started"
}

function Stop-ActionPacker {
    $Task = Test-TaskInstalled
    Write-Host "Stopping Action Packer..." -ForegroundColor Cyan
    
    if ($Task.State -ne "Running") {
        Write-InfoMessage "Service is not running"
        return
    }
    
    Stop-ScheduledTask -TaskName $TaskName
    
    # Also kill any node processes running from this directory
    $NodeProcesses = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -and ($_.CommandLine -match [regex]::Escape($ProjectDir))
    }
    if ($NodeProcesses) {
        $NodeProcesses | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    }
    
    Write-StatusMessage "Service stopped"
}

function Restart-ActionPacker {
    $Task = Test-TaskInstalled
    Write-Host "Restarting Action Packer..." -ForegroundColor Cyan
    
    if ($Task.State -eq "Running") {
        Stop-ScheduledTask -TaskName $TaskName
        Start-Sleep -Seconds 1
    }
    
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 2
    Write-StatusMessage "Service restarted"
}

function Show-Status {
    $Task = Test-TaskInstalled
    
    Write-Host "Action Packer Status" -ForegroundColor Cyan
    Write-Host "─────────────────────"
    
    $StateColor = switch ($Task.State) {
        "Running" { "Green" }
        "Ready" { "Yellow" }
        default { "Red" }
    }
    
    Write-Host "Status: " -NoNewline
    Write-Host $Task.State -ForegroundColor $StateColor
    
    Write-Host "Task Name: $TaskName"
    Write-Host "Last Run: $($Task.LastRunTime)"
    Write-Host "Last Result: $($Task.LastTaskResult)"
    
    Write-Host ""
    Write-Host "Log files:"
    Write-Host "  stdout: $LogDir\stdout.log"
    Write-Host "  stderr: $LogDir\stderr.log"
    
    # Check if port is listening
    $Port = 3001
    $EnvFile = Join-Path $ProjectDir "backend\.env"
    if (Test-Path $EnvFile) {
        $PortLine = Get-Content $EnvFile | Where-Object { $_ -match '^PORT=' }
        if ($PortLine) {
            $Port = ($PortLine -split '=')[1].Trim()
        }
    }
    
    $Listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    Write-Host ""
    if ($Listening) {
        Write-StatusMessage "Server is listening on port $Port"
    } else {
        Write-WarningMessage "Server is not listening on port $Port"
    }
}

function Show-Logs {
    Test-TaskInstalled | Out-Null
    
    $StdOutLog = Join-Path $LogDir "stdout.log"
    
    if (-not (Test-Path $StdOutLog)) {
        Write-ErrorMessage "Log file not found: $StdOutLog"
        exit 1
    }
    
    Write-Host "Showing logs (Ctrl+C to exit)..." -ForegroundColor Cyan
    Get-Content $StdOutLog -Wait -Tail 50
}

function Show-Help {
    Write-Host "Action Packer Service Control" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Usage: .\service.ps1 <command>"
    Write-Host ""
    Write-Host "Commands:"
    Write-Host "  start     Start the service"
    Write-Host "  stop      Stop the service"
    Write-Host "  restart   Restart the service"
    Write-Host "  status    Show service status"
    Write-Host "  logs      Follow log output"
    Write-Host "  help      Show this help message"
    Write-Host ""
}

# Main
switch ($Command) {
    "start"   { Start-ActionPacker }
    "stop"    { Stop-ActionPacker }
    "restart" { Restart-ActionPacker }
    "status"  { Show-Status }
    "logs"    { Show-Logs }
    "help"    { Show-Help }
}
