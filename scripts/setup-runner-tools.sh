#!/bin/bash
# Setup script to install GitHub-hosted runner software locally
# This script can either use the official runner-images scripts from GitHub
# or fall back to standalone installation methods.
#
# Official source: https://github.com/actions/runner-images
# Reference: macOS 26 / Ubuntu 24.04 runner images

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

# Detect OS
OS="$(uname -s)"
ARCH="$(uname -m)"

# Runner images repository
RUNNER_IMAGES_REPO="https://github.com/actions/runner-images.git"
RUNNER_IMAGES_DIR="${HOME}/.action-packer/runner-images"

print_header "GitHub Runner Tools Setup"
echo "Detected OS: $OS ($ARCH)"
echo ""
echo "This script installs tools commonly found on GitHub-hosted runners."
echo "Source: https://github.com/actions/runner-images"
echo ""

# Parse arguments
INSTALL_XCODE=false
INSTALL_SIMULATORS=false
INSTALL_ANDROID=false
INSTALL_LANGUAGES=false
INSTALL_UTILITIES=true  # Default: always install utilities
INSTALL_ALL=false
USE_OFFICIAL_SCRIPTS=false
LIST_SCRIPTS=false

show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --all             Install everything (languages, Xcode, simulators, Android)"
    echo "  --utilities       Install common utilities only (default)"
    echo "  --languages       Install language runtimes (Node.js, Python, Go, Ruby, Rust, Java)"
    echo "  --xcode           Install/update Xcode Command Line Tools (macOS only)"
    echo "  --simulators      Install iOS/watchOS/tvOS/visionOS simulators (macOS only)"
    echo "  --android         Install Android SDK and tools"
    echo "  --official        Use official runner-images scripts from GitHub"
    echo "  --list-scripts    List available official scripts and exit"
    echo "  --run <script>    Run a specific official script (e.g., install-python.sh)"
    echo "  --help            Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 --all                         # Install everything (standalone mode)"
    echo "  $0 --official --languages        # Use official scripts for languages"
    echo "  $0 --list-scripts                # Show available official scripts"
    echo "  $0 --run install-homebrew.sh     # Run specific official script"
    exit 0
}

# Parse command line arguments
RUN_SCRIPT=""
if [ $# -eq 0 ]; then
    INSTALL_UTILITIES=true
else
    INSTALL_UTILITIES=false
    while [ $# -gt 0 ]; do
        case "$1" in
            --all)
                INSTALL_ALL=true
                INSTALL_UTILITIES=true
                INSTALL_LANGUAGES=true
                INSTALL_XCODE=true
                INSTALL_SIMULATORS=true
                INSTALL_ANDROID=true
                ;;
            --utilities)
                INSTALL_UTILITIES=true
                ;;
            --languages)
                INSTALL_LANGUAGES=true
                ;;
            --xcode)
                INSTALL_XCODE=true
                ;;
            --simulators)
                INSTALL_SIMULATORS=true
                ;;
            --android)
                INSTALL_ANDROID=true
                ;;
            --official)
                USE_OFFICIAL_SCRIPTS=true
                ;;
            --list-scripts)
                LIST_SCRIPTS=true
                ;;
            --run)
                shift
                RUN_SCRIPT="$1"
                USE_OFFICIAL_SCRIPTS=true
                ;;
            --help|-h)
                show_help
                ;;
            *)
                print_error "Unknown option: $1"
                show_help
                ;;
        esac
        shift
    done
fi

# ============================================================================
# Official Runner Images Repository Management
# ============================================================================
clone_or_update_runner_images() {
    print_header "GitHub Runner Images Repository"
    
    mkdir -p "$(dirname "$RUNNER_IMAGES_DIR")"
    
    if [ -d "$RUNNER_IMAGES_DIR/.git" ]; then
        print_info "Updating runner-images repository..."
        cd "$RUNNER_IMAGES_DIR"
        git fetch origin
        git reset --hard origin/main
        cd - > /dev/null
        print_success "Repository updated"
    else
        print_info "Cloning runner-images repository..."
        git clone --depth 1 "$RUNNER_IMAGES_REPO" "$RUNNER_IMAGES_DIR"
        print_success "Repository cloned"
    fi
}

# Get the appropriate image folder based on OS
get_image_folder() {
    if [ "$OS" = "Darwin" ]; then
        echo "$RUNNER_IMAGES_DIR/images/macos"
    else
        echo "$RUNNER_IMAGES_DIR/images/ubuntu"
    fi
}

# Get the appropriate toolset file
get_toolset_file() {
    local image_folder
    image_folder=$(get_image_folder)
    
    if [ "$OS" = "Darwin" ]; then
        # Detect macOS version and use appropriate toolset
        local macos_version
        macos_version=$(sw_vers -productVersion | cut -d. -f1)
        
        if [ -f "$image_folder/toolsets/toolset-${macos_version}.json" ]; then
            echo "$image_folder/toolsets/toolset-${macos_version}.json"
        else
            # Fall back to latest available
            ls -1 "$image_folder/toolsets"/toolset-*.json 2>/dev/null | sort -V | tail -1
        fi
    else
        # Ubuntu - detect version
        if [ -f /etc/os-release ]; then
            local ubuntu_version
            ubuntu_version=$(grep VERSION_ID /etc/os-release | cut -d'"' -f2 | cut -d'.' -f1)
            
            if [ -f "$image_folder/toolsets/toolset-${ubuntu_version}04.json" ]; then
                echo "$image_folder/toolsets/toolset-${ubuntu_version}04.json"
            else
                ls -1 "$image_folder/toolsets"/toolset-*.json 2>/dev/null | sort -V | tail -1
            fi
        fi
    fi
}

# Setup the environment for official scripts
setup_official_environment() {
    local image_folder
    image_folder=$(get_image_folder)
    
    # Create required directories
    mkdir -p ~/utils
    mkdir -p ~/image-generation
    
    # Copy helper scripts
    if [ "$OS" = "Darwin" ]; then
        cp "$image_folder/scripts/helpers/utils.sh" ~/utils/ 2>/dev/null || true
        cp -r "$image_folder/scripts/helpers/"*.psm1 ~/image-generation/helpers/ 2>/dev/null || true
    else
        cp "$RUNNER_IMAGES_DIR/images/ubuntu/scripts/helpers/"*.sh ~/utils/ 2>/dev/null || true
    fi
    
    # Set environment variables
    export IMAGE_FOLDER="$image_folder"
    export INSTALLER_SCRIPT_FOLDER="$image_folder/scripts/build"
    export HELPER_SCRIPTS=~/utils
    
    # Copy toolset.json to expected location
    local toolset_file
    toolset_file=$(get_toolset_file)
    if [ -n "$toolset_file" ] && [ -f "$toolset_file" ]; then
        cp "$toolset_file" "$image_folder/toolset.json"
        print_success "Using toolset: $(basename "$toolset_file")"
    fi
}

# List available official scripts
list_official_scripts() {
    clone_or_update_runner_images
    
    local image_folder
    image_folder=$(get_image_folder)
    
    print_header "Available Official Scripts"
    
    echo "Shell scripts (.sh):"
    ls -1 "$image_folder/scripts/build/"*.sh 2>/dev/null | xargs -I {} basename {} | sort
    
    echo ""
    echo "PowerShell scripts (.ps1):"
    ls -1 "$image_folder/scripts/build/"*.ps1 2>/dev/null | xargs -I {} basename {} | sort
    
    echo ""
    echo "Usage: $0 --run <script-name>"
    echo "Example: $0 --run install-python.sh"
}

# Run a specific official script
run_official_script() {
    local script_name="$1"
    local image_folder
    image_folder=$(get_image_folder)
    
    local script_path="$image_folder/scripts/build/$script_name"
    
    if [ ! -f "$script_path" ]; then
        print_error "Script not found: $script_name"
        print_info "Use --list-scripts to see available scripts"
        exit 1
    fi
    
    print_header "Running: $script_name"
    
    setup_official_environment
    
    # Source utils if available
    if [ -f ~/utils/utils.sh ]; then
        source ~/utils/utils.sh
    fi
    
    # Run the script
    if [[ "$script_name" == *.ps1 ]]; then
        if command -v pwsh &> /dev/null; then
            pwsh -File "$script_path"
        else
            print_error "PowerShell (pwsh) is required to run .ps1 scripts"
            print_info "Install with: brew install powershell/tap/powershell"
            exit 1
        fi
    else
        chmod +x "$script_path"
        bash "$script_path"
    fi
    
    print_success "Script completed: $script_name"
}

# ============================================================================
# Official Scripts Installation (using runner-images repo)
# ============================================================================
install_with_official_scripts() {
    clone_or_update_runner_images
    setup_official_environment
    
    local image_folder
    image_folder=$(get_image_folder)
    
    # Source utils
    if [ -f ~/utils/utils.sh ]; then
        source ~/utils/utils.sh
    fi
    
    if [ "$INSTALL_UTILITIES" = true ]; then
        print_header "Installing Utilities (Official Scripts)"
        
        # Run common utils installer
        if [ -f "$image_folder/scripts/build/install-common-utils.sh" ]; then
            bash "$image_folder/scripts/build/install-common-utils.sh" || print_warning "Some utilities may have failed"
        fi
    fi
    
    if [ "$INSTALL_LANGUAGES" = true ]; then
        print_header "Installing Languages (Official Scripts)"
        
        local lang_scripts=(
            "install-python.sh"
            "install-node.sh"
            "install-ruby.sh"
            "install-rust.sh"
            "install-dotnet.sh"
        )
        
        for script in "${lang_scripts[@]}"; do
            if [ -f "$image_folder/scripts/build/$script" ]; then
                print_info "Running $script..."
                bash "$image_folder/scripts/build/$script" || print_warning "Failed: $script"
            fi
        done
        
        # Java via PowerShell script
        if [ -f "$image_folder/scripts/build/install-openjdk.sh" ]; then
            print_info "Running install-openjdk.sh..."
            bash "$image_folder/scripts/build/install-openjdk.sh" || print_warning "Failed: install-openjdk.sh"
        fi
    fi
    
    if [ "$INSTALL_XCODE" = true ] && [ "$OS" = "Darwin" ]; then
        print_header "Installing Xcode Tools (Official Scripts)"
        
        if [ -f "$image_folder/scripts/build/install-xcode-clt.sh" ]; then
            bash "$image_folder/scripts/build/install-xcode-clt.sh" || print_warning "Xcode CLT installation may have failed"
        fi
    fi
    
    if [ "$INSTALL_ANDROID" = true ]; then
        print_header "Installing Android SDK (Official Scripts)"
        
        if [ -f "$image_folder/scripts/build/install-android-sdk.sh" ]; then
            bash "$image_folder/scripts/build/install-android-sdk.sh" || print_warning "Android SDK installation may have failed"
        fi
    fi
    
    print_success "Official scripts installation complete"
}

# ============================================================================
# macOS: Homebrew Installation
# ============================================================================
install_homebrew() {
    if [ "$OS" != "Darwin" ]; then
        return
    fi
    
    print_header "Homebrew"
    
    if command -v brew &> /dev/null; then
        print_success "Homebrew is already installed"
        brew --version
        print_info "Updating Homebrew..."
        brew update
    else
        print_info "Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        
        # Add to PATH for Apple Silicon
        if [ "$ARCH" = "arm64" ]; then
            echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
            eval "$(/opt/homebrew/bin/brew shellenv)"
        fi
        print_success "Homebrew installed"
    fi
}

# ============================================================================
# Common Utilities (Homebrew on macOS, apt on Linux)
# ============================================================================
install_utilities() {
    print_header "Common Utilities"
    
    if [ "$OS" = "Darwin" ]; then
        # macOS - use Homebrew
        # Based on macOS 26 runner image utilities
        BREW_PACKAGES=(
            "aria2"         # Download utility
            "bazelisk"      # Bazel version manager
            "cmake"         # Build system
            "git"           # Version control
            "git-lfs"       # Git Large File Storage
            "gh"            # GitHub CLI
            "gnu-tar"       # GNU tar (gtar)
            "gnupg"         # GPG
            "jq"            # JSON processor
            "wget"          # Download utility
            "yq"            # YAML processor
            "zstd"          # Compression
            "ninja"         # Build system
            "p7zip"         # 7-Zip
            "openssl@3"     # OpenSSL
            "packer"        # HashiCorp Packer
            "unxip"         # Fast .xip extractor
        )
        
        print_info "Installing Homebrew packages..."
        for pkg in "${BREW_PACKAGES[@]}"; do
            if brew list "$pkg" &> /dev/null; then
                print_success "$pkg is already installed"
            else
                print_info "Installing $pkg..."
                brew install "$pkg" || print_warning "Failed to install $pkg"
            fi
        done
        
        # Install casks for browsers (optional)
        print_info "Browser installation is skipped (install manually if needed)"
        
    elif [ "$OS" = "Linux" ]; then
        # Linux - use apt (Debian/Ubuntu)
        if command -v apt-get &> /dev/null; then
            print_info "Updating apt..."
            sudo apt-get update
            
            APT_PACKAGES=(
                "aria2"
                "cmake"
                "git"
                "git-lfs"
                "gnupg"
                "jq"
                "wget"
                "zstd"
                "ninja-build"
                "p7zip-full"
                "openssl"
                "curl"
                "unzip"
                "tar"
            )
            
            print_info "Installing apt packages..."
            for pkg in "${APT_PACKAGES[@]}"; do
                if dpkg -l "$pkg" &> /dev/null 2>&1; then
                    print_success "$pkg is already installed"
                else
                    print_info "Installing $pkg..."
                    sudo apt-get install -y "$pkg" || print_warning "Failed to install $pkg"
                fi
            done
            
            # Install GitHub CLI
            if ! command -v gh &> /dev/null; then
                print_info "Installing GitHub CLI..."
                curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
                echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
                sudo apt-get update
                sudo apt-get install -y gh
            fi
            
            # Install yq
            if ! command -v yq &> /dev/null; then
                print_info "Installing yq..."
                sudo wget -qO /usr/local/bin/yq https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64
                sudo chmod +x /usr/local/bin/yq
            fi
        else
            print_warning "apt-get not found. Please install packages manually."
        fi
    fi
    
    print_success "Utilities installation complete"
}

# ============================================================================
# Language Runtimes
# ============================================================================
install_languages() {
    print_header "Language Runtimes"
    
    # Node.js via nvm (versions: 20, 22, 24)
    print_info "Setting up Node.js..."
    if [ ! -d "$HOME/.nvm" ]; then
        print_info "Installing nvm..."
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    else
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        print_success "nvm is already installed"
    fi
    
    # Install Node.js versions
    for version in 20 22 24; do
        if nvm ls "$version" &> /dev/null 2>&1; then
            print_success "Node.js $version is already installed"
        else
            print_info "Installing Node.js $version..."
            nvm install "$version" || print_warning "Failed to install Node.js $version"
        fi
    done
    nvm alias default 24
    print_success "Node.js setup complete (default: 24)"
    
    # Python via pyenv (versions: 3.11, 3.12, 3.13, 3.14)
    print_info "Setting up Python..."
    if ! command -v pyenv &> /dev/null; then
        if [ "$OS" = "Darwin" ]; then
            brew install pyenv
        else
            curl https://pyenv.run | bash
        fi
        
        # Add pyenv to shell
        echo 'export PYENV_ROOT="$HOME/.pyenv"' >> ~/.zshrc
        echo 'command -v pyenv >/dev/null || export PATH="$PYENV_ROOT/bin:$PATH"' >> ~/.zshrc
        echo 'eval "$(pyenv init -)"' >> ~/.zshrc
        
        export PYENV_ROOT="$HOME/.pyenv"
        export PATH="$PYENV_ROOT/bin:$PATH"
        eval "$(pyenv init -)"
    else
        print_success "pyenv is already installed"
    fi
    
    # Install Python versions
    for version in 3.11 3.12 3.13 3.14; do
        latest=$(pyenv install --list | grep -E "^\s*$version\.[0-9]+$" | tail -1 | tr -d ' ')
        if [ -n "$latest" ]; then
            if pyenv versions | grep -q "$latest"; then
                print_success "Python $latest is already installed"
            else
                print_info "Installing Python $latest..."
                pyenv install "$latest" || print_warning "Failed to install Python $latest"
            fi
        fi
    done
    
    # Set the latest installed Python 3.11-3.14 as the global default, or fall back to system
    LATEST_PYTHON=$(pyenv versions --bare | grep -E '^(3\.11|3\.12|3\.13|3\.14)\.' | sort -V | tail -1)
    if [ -n "$LATEST_PYTHON" ]; then
        pyenv global "$LATEST_PYTHON" 2>/dev/null || pyenv global system
    else
        pyenv global system
    fi
    print_success "Python setup complete"
    
    # Go (versions: 1.23, 1.24, 1.25)
    print_info "Setting up Go..."
    if [ "$OS" = "Darwin" ]; then
        if ! command -v go &> /dev/null; then
            brew install go
        fi
        print_success "Go installed via Homebrew"
    else
        # Install latest Go on Linux
        GO_VERSION="1.24.4"
        if ! command -v go &> /dev/null; then
            print_info "Installing Go $GO_VERSION..."
            wget -q "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -O /tmp/go.tar.gz
            sudo rm -rf /usr/local/go
            sudo tar -C /usr/local -xzf /tmp/go.tar.gz
            rm /tmp/go.tar.gz
            echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.zshrc
            export PATH=$PATH:/usr/local/go/bin
        fi
        print_success "Go setup complete"
    fi
    
    # Ruby via rbenv (versions: 3.2, 3.3, 3.4)
    print_info "Setting up Ruby..."
    if ! command -v rbenv &> /dev/null; then
        if [ "$OS" = "Darwin" ]; then
            brew install rbenv ruby-build
        else
            git clone https://github.com/rbenv/rbenv.git ~/.rbenv
            git clone https://github.com/rbenv/ruby-build.git ~/.rbenv/plugins/ruby-build
            echo 'export PATH="$HOME/.rbenv/bin:$PATH"' >> ~/.zshrc
            echo 'eval "$(rbenv init -)"' >> ~/.zshrc
            export PATH="$HOME/.rbenv/bin:$PATH"
            eval "$(rbenv init -)"
        fi
    else
        print_success "rbenv is already installed"
    fi
    
    # Install Ruby versions (latest patch for each minor version)
    for minor_version in 3.2 3.3 3.4; do
        latest=$(rbenv install -l 2>/dev/null | grep -E "^\s*${minor_version}\.[0-9]+$" | tail -1 | tr -d ' ')
        if [ -z "$latest" ]; then
            # Fallback: try without the list filtering
            latest=$(rbenv install --list-all 2>/dev/null | grep -E "^\s*${minor_version}\.[0-9]+$" | tail -1 | tr -d ' ')
        fi
        if [ -n "$latest" ]; then
            if rbenv versions | grep -q "$latest"; then
                print_success "Ruby $latest is already installed"
            else
                print_info "Installing Ruby $latest..."
                rbenv install "$latest" || print_warning "Failed to install Ruby $latest"
            fi
        else
            print_warning "Could not find latest Ruby $minor_version version"
        fi
    done
    
    # Set the latest installed Ruby 3.x as the global default
    LATEST_RUBY=$(rbenv versions --bare | grep -E '^3\.' | sort -V | tail -1)
    if [ -n "$LATEST_RUBY" ]; then
        rbenv global "$LATEST_RUBY"
    fi
    print_success "Ruby setup complete"
    
    # Rust via rustup
    print_info "Setting up Rust..."
    if ! command -v rustup &> /dev/null; then
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        source "$HOME/.cargo/env"
    else
        print_success "Rust is already installed"
        rustup update
    fi
    print_success "Rust setup complete"
    
    # Java via SDKMAN or Homebrew
    print_info "Setting up Java..."
    if [ "$OS" = "Darwin" ]; then
        # Install multiple Java versions via Homebrew
        for version in openjdk@11 openjdk@17 openjdk@21; do
            if brew list "$version" &> /dev/null; then
                print_success "$version is already installed"
            else
                print_info "Installing $version..."
                brew install "$version" || print_warning "Failed to install $version"
            fi
        done
    else
        # Use SDKMAN on Linux
        if [ ! -d "$HOME/.sdkman" ]; then
            curl -s "https://get.sdkman.io" | bash
            source "$HOME/.sdkman/bin/sdkman-init.sh"
        fi
        print_success "Java setup available via SDKMAN"
    fi
    
    # .NET SDK
    print_info "Setting up .NET..."
    if ! command -v dotnet &> /dev/null; then
        if [ "$OS" = "Darwin" ]; then
            brew install --cask dotnet-sdk
        else
            # Install .NET on Linux
            wget https://dot.net/v1/dotnet-install.sh -O /tmp/dotnet-install.sh
            chmod +x /tmp/dotnet-install.sh
            /tmp/dotnet-install.sh --channel 8.0
            /tmp/dotnet-install.sh --channel 9.0
            echo 'export DOTNET_ROOT=$HOME/.dotnet' >> ~/.zshrc
            echo 'export PATH=$PATH:$DOTNET_ROOT:$DOTNET_ROOT/tools' >> ~/.zshrc
        fi
    else
        print_success ".NET is already installed"
    fi
    
    print_success "Language runtimes installation complete"
}

# ============================================================================
# Xcode Command Line Tools (macOS only)
# ============================================================================
install_xcode_tools() {
    if [ "$OS" != "Darwin" ]; then
        print_warning "Xcode tools are only available on macOS"
        return
    fi
    
    print_header "Xcode Command Line Tools"
    
    if xcode-select -p &> /dev/null; then
        print_success "Xcode Command Line Tools are already installed"
        xcode-select -p
    else
        print_info "Installing Xcode Command Line Tools..."
        xcode-select --install
        print_warning "Please complete the installation in the dialog that appeared"
        print_warning "Run this script again after installation completes"
    fi
    
    # Install xcodes for managing Xcode versions
    if ! command -v xcodes &> /dev/null; then
        print_info "Installing xcodes (Xcode version manager)..."
        brew install xcodesorg/made/xcodes
    else
        print_success "xcodes is already installed"
    fi
    
    # Install additional iOS development tools
    XCODE_TOOLS=(
        "swiftformat"   # Swift code formatter
        "xcbeautify"    # Xcode build output formatter
        "fastlane"      # iOS automation
        "cocoapods"     # Dependency manager
        "carthage"      # Dependency manager
    )
    
    for tool in "${XCODE_TOOLS[@]}"; do
        if brew list "$tool" &> /dev/null; then
            print_success "$tool is already installed"
        else
            print_info "Installing $tool..."
            brew install "$tool" || print_warning "Failed to install $tool"
        fi
    done
    
    print_success "Xcode tools installation complete"
}

# ============================================================================
# iOS/watchOS/tvOS/visionOS Simulators (macOS only)
# ============================================================================
install_simulators() {
    if [ "$OS" != "Darwin" ]; then
        print_warning "Simulators are only available on macOS"
        return
    fi
    
    print_header "iOS/watchOS/tvOS/visionOS Simulators"
    
    # Check if Xcode is installed
    if ! command -v xcrun &> /dev/null; then
        print_error "Xcode must be installed first. Please install Xcode from the App Store."
        return 1
    fi
    
    print_info "Available simulator runtimes:"
    xcrun simctl runtime list 2>/dev/null || print_warning "Could not list runtimes"
    
    echo ""
    print_info "To install additional simulator runtimes, use:"
    echo "  xcodebuild -downloadPlatform iOS"
    echo "  xcodebuild -downloadPlatform watchOS"
    echo "  xcodebuild -downloadPlatform tvOS"
    echo "  xcodebuild -downloadPlatform visionOS"
    echo ""
    
    # Download iOS platform (most commonly needed)
    read -p "Download iOS simulator runtime? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_info "Downloading iOS simulator runtime..."
        xcodebuild -downloadPlatform iOS || print_warning "Failed to download iOS runtime"
    fi
    
    # Download watchOS platform
    read -p "Download watchOS simulator runtime? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_info "Downloading watchOS simulator runtime..."
        xcodebuild -downloadPlatform watchOS || print_warning "Failed to download watchOS runtime"
    fi
    
    # Download tvOS platform
    read -p "Download tvOS simulator runtime? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_info "Downloading tvOS simulator runtime..."
        xcodebuild -downloadPlatform tvOS || print_warning "Failed to download tvOS runtime"
    fi
    
    # Download visionOS platform
    read -p "Download visionOS simulator runtime? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_info "Downloading visionOS simulator runtime..."
        xcodebuild -downloadPlatform visionOS || print_warning "Failed to download visionOS runtime"
    fi
    
    print_info "Installed simulators:"
    xcrun simctl list devices available 2>/dev/null | head -50
    
    print_success "Simulator setup complete"
}

# ============================================================================
# Android SDK (macOS and Linux)
# ============================================================================
install_android() {
    print_header "Android SDK"
    
    ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
    if [ "$OS" = "Linux" ]; then
        ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
    fi
    
    if [ -d "$ANDROID_HOME" ]; then
        print_success "Android SDK found at $ANDROID_HOME"
    else
        print_info "Installing Android SDK..."
        
        if [ "$OS" = "Darwin" ]; then
            # Install via Homebrew cask
            brew install --cask android-commandlinetools
            
            # Set up Android SDK
            mkdir -p "$HOME/Library/Android/sdk"
            export ANDROID_HOME="$HOME/Library/Android/sdk"
        else
            # Download command line tools for Linux
            mkdir -p "$ANDROID_HOME/cmdline-tools"
            cd /tmp
            wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O cmdline-tools.zip
            unzip -q cmdline-tools.zip
            mv cmdline-tools "$ANDROID_HOME/cmdline-tools/latest"
            rm cmdline-tools.zip
        fi
    fi
    
    # Add to PATH
    export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
    
    # Accept licenses and install common packages
    if command -v sdkmanager &> /dev/null; then
        print_info "Installing Android SDK packages..."
        yes | sdkmanager --licenses 2>/dev/null || true
        
        # Install common packages (based on macOS 26 runner)
        ANDROID_PACKAGES=(
            "platform-tools"
            "platforms;android-35"
            "platforms;android-36"
            "build-tools;35.0.0"
            "build-tools;36.0.0"
            "emulator"
            "ndk;27.3.13750724"
        )
        
        for pkg in "${ANDROID_PACKAGES[@]}"; do
            print_info "Installing $pkg..."
            sdkmanager "$pkg" || print_warning "Failed to install $pkg"
        done
    else
        print_warning "sdkmanager not found. Please install Android SDK manually."
    fi
    
    # Add environment variables to shell config
    if [ "$OS" = "Darwin" ]; then
        SHELL_RC="$HOME/.zshrc"
    else
        SHELL_RC="$HOME/.bashrc"
    fi
    
    if ! grep -q "ANDROID_HOME" "$SHELL_RC" 2>/dev/null; then
        echo "" >> "$SHELL_RC"
        echo "# Android SDK" >> "$SHELL_RC"
        echo "export ANDROID_HOME=\"$ANDROID_HOME\"" >> "$SHELL_RC"
        echo "export PATH=\"\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools:\$PATH\"" >> "$SHELL_RC"
    fi
    
    print_success "Android SDK installation complete"
}

# ============================================================================
# Main Installation Flow
# ============================================================================
main() {
    # Handle --list-scripts first
    if [ "$LIST_SCRIPTS" = true ]; then
        list_official_scripts
        exit 0
    fi
    
    # Handle --run <script>
    if [ -n "$RUN_SCRIPT" ]; then
        clone_or_update_runner_images
        run_official_script "$RUN_SCRIPT"
        exit 0
    fi
    
    echo "Installation options:"
    echo "  Utilities:       $INSTALL_UTILITIES"
    echo "  Languages:       $INSTALL_LANGUAGES"
    echo "  Xcode:           $INSTALL_XCODE"
    echo "  Simulators:      $INSTALL_SIMULATORS"
    echo "  Android:         $INSTALL_ANDROID"
    echo "  Official Mode:   $USE_OFFICIAL_SCRIPTS"
    echo ""
    
    # Confirm before proceeding
    read -p "Proceed with installation? (Y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        print_info "Installation cancelled"
        exit 0
    fi
    
    # Use official scripts if requested
    if [ "$USE_OFFICIAL_SCRIPTS" = true ]; then
        install_with_official_scripts
        
        # Simulators still need interactive handling
        if [ "$INSTALL_SIMULATORS" = true ] && [ "$OS" = "Darwin" ]; then
            install_simulators
        fi
    else
        # Standalone mode - use built-in installers
        
        # macOS: Install Homebrew first
        if [ "$OS" = "Darwin" ]; then
            install_homebrew
        fi
        
        # Install selected components
        if [ "$INSTALL_UTILITIES" = true ]; then
            install_utilities
        fi
        
        if [ "$INSTALL_LANGUAGES" = true ]; then
            install_languages
        fi
        
        if [ "$INSTALL_XCODE" = true ]; then
            install_xcode_tools
        fi
        
        if [ "$INSTALL_SIMULATORS" = true ]; then
            install_simulators
        fi
        
        if [ "$INSTALL_ANDROID" = true ]; then
            install_android
        fi
    fi
    
    print_header "Installation Complete!"
    
    # Suggest reloading the appropriate shell configuration file
    user_shell="$(basename "${SHELL:-}")"
    case "$user_shell" in
        zsh)
            reload_cmd="source ~/.zshrc"
            ;;
        bash)
            reload_cmd="source ~/.bashrc"
            ;;
        *)
            reload_cmd="source your shell's startup file (e.g., ~/.profile, ~/.bashrc, ~/.zshrc)"
            ;;
    esac
    
    echo "You may need to restart your terminal or run:"
    echo "  $reload_cmd"
    echo ""
    echo "To verify installations:"
    echo "  node --version"
    echo "  python3 --version"
    echo "  go version"
    echo "  ruby --version"
    echo "  rustc --version"
    echo "  java --version"
    echo ""
    
    if [ "$USE_OFFICIAL_SCRIPTS" = true ]; then
        echo "Official scripts were used from:"
        echo "  $RUNNER_IMAGES_DIR"
        echo ""
        echo "To update the scripts later, run:"
        echo "  cd $RUNNER_IMAGES_DIR && git pull"
        echo ""
    fi
}

main