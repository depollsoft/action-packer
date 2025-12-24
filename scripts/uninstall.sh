#!/bin/bash
#
# Action Packer Uninstallation Script
# Removes the service and optionally cleans up files
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Detect OS
OS="$(uname -s)"
case "$OS" in
    Darwin) OS_TYPE="macos" ;;
    Linux)  OS_TYPE="linux" ;;
    *)      echo -e "${RED}Unsupported operating system: $OS${NC}"; exit 1 ;;
esac

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║            Action Packer Uninstallation Script             ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

print_status() {
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

# Remove macOS launchd service
uninstall_macos_service() {
    echo -e "\n${BLUE}Removing macOS service...${NC}"
    
    PLIST_NAME="com.action-packer.server"
    PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
    LOG_DIR="$HOME/Library/Logs/ActionPacker"
    
    if [ -f "$PLIST_PATH" ]; then
        # Stop the service
        launchctl stop "$PLIST_NAME" 2>/dev/null || true
        print_status "Service stopped"
        
        # Unload the service
        launchctl unload "$PLIST_PATH" 2>/dev/null || true
        print_status "Service unloaded"
        
        # Remove the plist file
        rm -f "$PLIST_PATH"
        print_status "Removed plist file"
    else
        print_info "Service plist not found (may not be installed)"
    fi
    
    # Ask about logs
    if [ -d "$LOG_DIR" ]; then
        echo ""
        read -p "Remove log files at $LOG_DIR? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            rm -rf "$LOG_DIR"
            print_status "Removed log directory"
        else
            print_info "Log files preserved"
        fi
    fi
}

# Remove Linux systemd service
uninstall_linux_service() {
    echo -e "\n${BLUE}Removing Linux systemd service...${NC}"
    
    SERVICE_NAME="action-packer"
    SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
    
    if [ -f "$SERVICE_FILE" ]; then
        # Check if we have sudo access
        if ! sudo -n true 2>/dev/null; then
            print_warning "sudo access required for systemd service removal"
            print_info "You will be prompted for your password"
        fi
        
        # Stop the service
        sudo systemctl stop "$SERVICE_NAME" 2>/dev/null || true
        print_status "Service stopped"
        
        # Disable the service
        sudo systemctl disable "$SERVICE_NAME" 2>/dev/null || true
        print_status "Service disabled"
        
        # Remove the service file
        sudo rm -f "$SERVICE_FILE"
        print_status "Removed service file"
        
        # Reload systemd
        sudo systemctl daemon-reload
        print_status "Systemd daemon reloaded"
    else
        print_info "Service file not found (may not be installed)"
    fi
}

# Optional cleanup
cleanup_files() {
    echo ""
    read -p "Remove node_modules and build files? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cd "$PROJECT_DIR"
        rm -rf node_modules backend/node_modules frontend/node_modules
        rm -rf backend/dist frontend/dist
        print_status "Removed node_modules and build files"
    else
        print_info "Files preserved"
    fi
    
    echo ""
    read -p "Remove database and data files? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$PROJECT_DIR/backend/data"
        print_status "Removed data directory"
    else
        print_info "Data files preserved"
    fi
    
    echo ""
    read -p "Remove environment configuration (.env)? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -f "$PROJECT_DIR/backend/.env"
        print_status "Removed .env file"
    else
        print_info "Environment file preserved"
    fi
}

# Main uninstallation flow
main() {
    echo "Project directory: $PROJECT_DIR"
    echo "Operating system: $OS_TYPE"
    echo ""
    
    # Confirm uninstallation
    read -p "Are you sure you want to uninstall Action Packer? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "Uninstallation cancelled"
        exit 0
    fi
    
    # Remove platform-specific service
    case "$OS_TYPE" in
        macos) uninstall_macos_service ;;
        linux) uninstall_linux_service ;;
    esac
    
    # Optional file cleanup
    cleanup_files
    
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║            Uninstallation Complete! 👋                     ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    print_info "Action Packer service has been removed."
    print_info "The project files remain in: $PROJECT_DIR"
    echo ""
}

# Handle command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --help, -h    Show this help message"
            echo ""
            echo "This script will:"
            echo "  - Stop and remove the Action Packer service"
            echo "  - Optionally remove logs, build files, and data"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

main
