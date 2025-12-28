<# 
.SYNOPSIS
    Setup script to install GitHub-hosted runner software locally on Windows
    Based on: https://github.com/actions/runner-images

.DESCRIPTION
    This script installs common tools found on GitHub Actions Windows runners.
    It uses winget, chocolatey, and direct downloads to install software.

.PARAMETER All
    Install everything (utilities, languages, Android)

.PARAMETER Utilities
    Install common utilities only (default)

.PARAMETER Languages
    Install language runtimes (Node.js, Python, Go, Ruby, Rust, Java)

.PARAMETER Android
    Install Android SDK and tools

.EXAMPLE
    .\setup-runner-tools.ps1 -All
    .\setup-runner-tools.ps1 -Languages
    .\setup-runner-tools.ps1 -Utilities -Languages
#>

param(
    [switch]$All,
    [switch]$Utilities,
    [switch]$Languages,
    [switch]$Android,
    [switch]$Help
)

# Colors and formatting
function Write-Header {
    param([string]$Message)
    Write-Host ""
    Write-Host ("=" * 65) -ForegroundColor Blue
    Write-Host "  $Message" -ForegroundColor Blue
    Write-Host ("=" * 65) -ForegroundColor Blue
    Write-Host ""
}

function Write-SuccessMessage {
    param([string]$Message)
    Write-Host "[OK] " -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Write-WarningMessage {
    param([string]$Message)
    Write-Host "[!] " -ForegroundColor Yellow -NoNewline
    Write-Host $Message
}

function Write-ErrorMessage {
    param([string]$Message)
    Write-Host "[X] " -ForegroundColor Red -NoNewline
    Write-Host $Message
}

function Write-InfoMessage {
    param([string]$Message)
    Write-Host "[i] " -ForegroundColor Cyan -NoNewline
    Write-Host $Message
}

function Show-HelpMessage {
    Write-Host @"
Usage: .\setup-runner-tools.ps1 [OPTIONS]

Options:
  -All           Install everything (languages, Android)
  -Utilities     Install common utilities only (default)
  -Languages     Install language runtimes (Node.js, Python, Go, Ruby, Rust, Java)
  -Android       Install Android SDK and tools
  -Help          Show this help message

Examples:
  .\setup-runner-tools.ps1 -All                 # Install everything
  .\setup-runner-tools.ps1 -Languages           # Install languages only
  .\setup-runner-tools.ps1 -Utilities -Android  # Install utilities and Android
"@
    exit 0
}

if ($Help) {
    Show-HelpMessage
}

# Default behavior
if (-not $All -and -not $Utilities -and -not $Languages -and -not $Android) {
    $Utilities = $true
}

if ($All) {
    $Utilities = $true
    $Languages = $true
    $Android = $true
}

Write-Header "GitHub Runner Tools Setup for Windows"
Write-Host "This script installs tools commonly found on GitHub-hosted runners."
Write-Host "Reference: Windows Server 2022 runner image"
Write-Host ""

# ============================================================================
# Check for Admin Rights
# ============================================================================
function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
    Write-WarningMessage "Some installations may require administrator privileges."
    Write-WarningMessage "Consider running this script as Administrator for full functionality."
    Write-Host ""
}

# ============================================================================
# Package Manager Setup
# ============================================================================
function Install-PackageManagers {
    Write-Header "Package Managers"
    
    # Check for winget
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-SuccessMessage "winget is available"
    } else {
        Write-WarningMessage "winget not found. Please install App Installer from Microsoft Store."
    }
    
    # Install/Check Chocolatey
    if (Get-Command choco -ErrorAction SilentlyContinue) {
        Write-SuccessMessage "Chocolatey is available"
    } else {
        Write-InfoMessage "Installing Chocolatey..."
        try {
            Set-ExecutionPolicy Bypass -Scope Process -Force
            [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
            Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
            Write-SuccessMessage "Chocolatey installed"
        } catch {
            Write-ErrorMessage "Failed to install Chocolatey: $_"
        }
    }
    
    # Install Scoop (user-level package manager)
    if (Get-Command scoop -ErrorAction SilentlyContinue) {
        Write-SuccessMessage "Scoop is available"
    } else {
        Write-InfoMessage "Installing Scoop..."
        try {
            Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
            Invoke-RestMethod get.scoop.sh | Invoke-Expression
            Write-SuccessMessage "Scoop installed"
        } catch {
            Write-ErrorMessage "Failed to install Scoop: $_"
        }
    }
}

# ============================================================================
# Common Utilities
# ============================================================================
function Install-Utilities {
    Write-Header "Common Utilities"
    
    # Winget packages
    $wingetPackages = @(
        @{ Id = "Git.Git"; Name = "Git" },
        @{ Id = "GitHub.GitLFS"; Name = "Git LFS" },
        @{ Id = "GitHub.cli"; Name = "GitHub CLI" },
        @{ Id = "jqlang.jq"; Name = "jq" },
        @{ Id = "GNU.Wget2"; Name = "wget" },
        @{ Id = "7zip.7zip"; Name = "7-Zip" },
        @{ Id = "Kitware.CMake"; Name = "CMake" },
        @{ Id = "GnuPG.GnuPG"; Name = "GnuPG" },
        @{ Id = "Facebook.Zstd"; Name = "zstd" }
    )
    
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-InfoMessage "Installing packages via winget..."
        foreach ($pkg in $wingetPackages) {
            $installed = winget list --id $pkg.Id 2>$null
            if ($LASTEXITCODE -eq 0 -and $installed -match $pkg.Id) {
                Write-SuccessMessage "$($pkg.Name) is already installed"
            } else {
                Write-InfoMessage "Installing $($pkg.Name)..."
                winget install --id $pkg.Id --silent --accept-package-agreements --accept-source-agreements 2>$null
                if ($LASTEXITCODE -eq 0) {
                    Write-SuccessMessage "$($pkg.Name) installed"
                } else {
                    Write-WarningMessage "Failed to install $($pkg.Name)"
                }
            }
        }
    }
    
    # Scoop packages (for tools not in winget)
    if (Get-Command scoop -ErrorAction SilentlyContinue) {
        $scoopPackages = @("aria2", "yq", "ninja", "packer")
        
        Write-InfoMessage "Installing packages via Scoop..."
        foreach ($pkg in $scoopPackages) {
            $installed = scoop list $pkg 2>$null
            if ($installed -match $pkg) {
                Write-SuccessMessage "$pkg is already installed"
            } else {
                Write-InfoMessage "Installing $pkg..."
                scoop install $pkg 2>$null
                if ($LASTEXITCODE -eq 0) {
                    Write-SuccessMessage "$pkg installed"
                } else {
                    Write-WarningMessage "Failed to install $pkg"
                }
            }
        }
    }
    
    Write-SuccessMessage "Utilities installation complete"
}

# ============================================================================
# Language Runtimes
# ============================================================================
function Install-Languages {
    Write-Header "Language Runtimes"
    
    # Node.js via nvm-windows
    Write-InfoMessage "Setting up Node.js..."
    if (Get-Command nvm -ErrorAction SilentlyContinue) {
        Write-SuccessMessage "nvm-windows is available"
    } else {
        Write-InfoMessage "Installing nvm-windows..."
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            winget install --id CoreyButler.NVMforWindows --silent --accept-package-agreements 2>$null
        } else {
            Write-WarningMessage "Please install nvm-windows manually from https://github.com/coreybutler/nvm-windows"
        }
    }
    
    # Install Node.js versions if nvm is available
    if (Get-Command nvm -ErrorAction SilentlyContinue) {
        foreach ($version in @("20", "22", "24")) {
            Write-InfoMessage "Installing Node.js $version..."
            nvm install $version 2>$null
        }
        nvm use 24 2>$null
        Write-SuccessMessage "Node.js setup complete"
    }
    
    # Python via winget (multiple versions)
    Write-InfoMessage "Setting up Python..."
    $pythonVersions = @(
        @{ Id = "Python.Python.3.11"; Name = "Python 3.11" },
        @{ Id = "Python.Python.3.12"; Name = "Python 3.12" },
        @{ Id = "Python.Python.3.13"; Name = "Python 3.13" }
    )
    
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        foreach ($py in $pythonVersions) {
            $installed = winget list --id $py.Id 2>$null
            if ($LASTEXITCODE -eq 0 -and $installed -match $py.Id) {
                Write-SuccessMessage "$($py.Name) is already installed"
            } else {
                Write-InfoMessage "Installing $($py.Name)..."
                winget install --id $py.Id --silent --accept-package-agreements 2>$null
            }
        }
    }
    
    # Go
    Write-InfoMessage "Setting up Go..."
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        $installed = winget list --id GoLang.Go 2>$null
        if ($LASTEXITCODE -eq 0 -and $installed -match "GoLang.Go") {
            Write-SuccessMessage "Go is already installed"
        } else {
            Write-InfoMessage "Installing Go..."
            winget install --id GoLang.Go --silent --accept-package-agreements 2>$null
        }
    }
    
    # Ruby via RubyInstaller
    Write-InfoMessage "Setting up Ruby..."
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        $installed = winget list --id RubyInstallerTeam.RubyWithDevKit.3.4 2>$null
        if ($LASTEXITCODE -eq 0 -and $installed -match "Ruby") {
            Write-SuccessMessage "Ruby is already installed"
        } else {
            Write-InfoMessage "Installing Ruby..."
            winget install --id RubyInstallerTeam.RubyWithDevKit.3.4 --silent --accept-package-agreements 2>$null
        }
    }
    
    # Rust via rustup
    Write-InfoMessage "Setting up Rust..."
    if (Get-Command rustup -ErrorAction SilentlyContinue) {
        Write-SuccessMessage "Rust is already installed"
        rustup update 2>$null
    } else {
        Write-InfoMessage "Installing Rust..."
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            winget install --id Rustlang.Rustup --silent --accept-package-agreements 2>$null
        } else {
            # Direct download
            Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile "$env:TEMP\rustup-init.exe"
            & "$env:TEMP\rustup-init.exe" -y
        }
    }
    
    # Java via Microsoft OpenJDK
    Write-InfoMessage "Setting up Java..."
    $javaVersions = @(
        @{ Id = "Microsoft.OpenJDK.11"; Name = "OpenJDK 11" },
        @{ Id = "Microsoft.OpenJDK.17"; Name = "OpenJDK 17" },
        @{ Id = "Microsoft.OpenJDK.21"; Name = "OpenJDK 21" }
    )
    
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        foreach ($java in $javaVersions) {
            $installed = winget list --id $java.Id 2>$null
            if ($LASTEXITCODE -eq 0 -and $installed -match $java.Id) {
                Write-SuccessMessage "$($java.Name) is already installed"
            } else {
                Write-InfoMessage "Installing $($java.Name)..."
                winget install --id $java.Id --silent --accept-package-agreements 2>$null
            }
        }
    }
    
    # .NET SDK
    Write-InfoMessage "Setting up .NET..."
    $dotnetVersions = @(
        @{ Id = "Microsoft.DotNet.SDK.8"; Name = ".NET 8 SDK" },
        @{ Id = "Microsoft.DotNet.SDK.9"; Name = ".NET 9 SDK" }
    )
    
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        foreach ($sdk in $dotnetVersions) {
            $installed = winget list --id $sdk.Id 2>$null
            if ($LASTEXITCODE -eq 0 -and $installed -match $sdk.Id) {
                Write-SuccessMessage "$($sdk.Name) is already installed"
            } else {
                Write-InfoMessage "Installing $($sdk.Name)..."
                winget install --id $sdk.Id --silent --accept-package-agreements 2>$null
            }
        }
    }
    
    Write-SuccessMessage "Language runtimes installation complete"
}

# ============================================================================
# Android SDK
# ============================================================================
function Install-Android {
    Write-Header "Android SDK"
    
    $androidHome = $env:ANDROID_HOME
    if (-not $androidHome) {
        $androidHome = "$env:LOCALAPPDATA\Android\Sdk"
    }
    
    if (Test-Path $androidHome) {
        Write-SuccessMessage "Android SDK found at $androidHome"
    } else {
        Write-InfoMessage "Installing Android Command Line Tools..."
        
        # Create directory
        New-Item -ItemType Directory -Force -Path $androidHome | Out-Null
        
        # Download command line tools
        $cmdlineToolsUrl = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
        $zipPath = "$env:TEMP\cmdline-tools.zip"
        
        Write-InfoMessage "Downloading Android Command Line Tools..."
        Invoke-WebRequest -Uri $cmdlineToolsUrl -OutFile $zipPath
        
        # Extract
        Expand-Archive -Path $zipPath -DestinationPath "$androidHome\cmdline-tools" -Force
        
        # Rename to 'latest'
        if (Test-Path "$androidHome\cmdline-tools\cmdline-tools") {
            Move-Item "$androidHome\cmdline-tools\cmdline-tools" "$androidHome\cmdline-tools\latest" -Force
        }
        
        Remove-Item $zipPath -Force
        Write-SuccessMessage "Android Command Line Tools installed"
    }
    
    # Set environment variables
    $env:ANDROID_HOME = $androidHome
    $env:PATH = "$androidHome\cmdline-tools\latest\bin;$androidHome\platform-tools;$env:PATH"
    
    # Set user environment variables
    [Environment]::SetEnvironmentVariable("ANDROID_HOME", $androidHome, "User")
    
    # Install SDK packages
    $sdkmanager = "$androidHome\cmdline-tools\latest\bin\sdkmanager.bat"
    if (Test-Path $sdkmanager) {
        Write-InfoMessage "Installing Android SDK packages..."
        
        # Accept licenses
        Write-InfoMessage "Accepting licenses..."
        echo "y" | & $sdkmanager --licenses 2>$null
        
        $packages = @(
            "platform-tools",
            "platforms;android-35",
            "platforms;android-36",
            "build-tools;35.0.0",
            "build-tools;36.0.0",
            "emulator"
        )
        
        foreach ($pkg in $packages) {
            Write-InfoMessage "Installing $pkg..."
            & $sdkmanager $pkg 2>$null
        }
    } else {
        Write-WarningMessage "sdkmanager not found. Please install Android SDK manually."
    }
    
    Write-SuccessMessage "Android SDK installation complete"
}

# ============================================================================
# Main Installation Flow
# ============================================================================
function Main {
    Write-Host "Installation options:"
    Write-Host "  Utilities:    $Utilities"
    Write-Host "  Languages:    $Languages"
    Write-Host "  Android:      $Android"
    Write-Host ""
    
    $response = Read-Host "Proceed with installation? (Y/n)"
    if ($response -eq "n" -or $response -eq "N") {
        Write-InfoMessage "Installation cancelled"
        exit 0
    }
    
    # Install package managers first
    Install-PackageManagers
    
    # Install selected components
    if ($Utilities) {
        Install-Utilities
    }
    
    if ($Languages) {
        Install-Languages
    }
    
    if ($Android) {
        Install-Android
    }
    
    Write-Header "Installation Complete!"
    Write-Host "You may need to restart your terminal to use the new tools."
    Write-Host ""
    Write-Host "To verify installations:"
    Write-Host "  node --version"
    Write-Host "  python --version"
    Write-Host "  go version"
    Write-Host "  ruby --version"
    Write-Host "  rustc --version"
    Write-Host "  java --version"
    Write-Host ""
}

Main
