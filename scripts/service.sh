#!/bin/bash
#
# Action Packer Service Control Script
# Quick commands to manage the Action Packer service
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Detect OS
OS="$(uname -s)"
case "$OS" in
    Darwin) OS_TYPE="macos" ;;
    Linux)  OS_TYPE="linux" ;;
    *)      echo -e "${RED}Unsupported operating system: $OS${NC}"; exit 1 ;;
esac

# Service names
MACOS_PLIST_NAME="com.action-packer.server"
MACOS_PLIST_PATH="$HOME/Library/LaunchAgents/${MACOS_PLIST_NAME}.plist"
LINUX_SERVICE_NAME="action-packer"

print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

# Check if service is installed
check_installed() {
    case "$OS_TYPE" in
        macos)
            if [ ! -f "$MACOS_PLIST_PATH" ]; then
                print_error "Service is not installed. Run install.sh first."
                exit 1
            fi
            ;;
        linux)
            if [ ! -f "/etc/systemd/system/${LINUX_SERVICE_NAME}.service" ]; then
                print_error "Service is not installed. Run install.sh first."
                exit 1
            fi
            ;;
    esac
}

# Start the service
start_service() {
    check_installed
    echo -e "${BLUE}Starting Action Packer...${NC}"
    
    case "$OS_TYPE" in
        macos)
            launchctl start "$MACOS_PLIST_NAME"
            ;;
        linux)
            sudo systemctl start "$LINUX_SERVICE_NAME"
            ;;
    esac
    
    sleep 2
    print_status "Service started"
}

# Stop the service
stop_service() {
    check_installed
    echo -e "${BLUE}Stopping Action Packer...${NC}"
    
    case "$OS_TYPE" in
        macos)
            launchctl stop "$MACOS_PLIST_NAME"
            ;;
        linux)
            sudo systemctl stop "$LINUX_SERVICE_NAME"
            ;;
    esac
    
    print_status "Service stopped"
}

# Restart the service
restart_service() {
    check_installed
    echo -e "${BLUE}Restarting Action Packer...${NC}"
    
    case "$OS_TYPE" in
        macos)
            launchctl stop "$MACOS_PLIST_NAME" 2>/dev/null || true
            sleep 1
            launchctl start "$MACOS_PLIST_NAME"
            ;;
        linux)
            sudo systemctl restart "$LINUX_SERVICE_NAME"
            ;;
    esac
    
    sleep 2
    print_status "Service restarted"
}

# Show service status
show_status() {
    check_installed
    echo -e "${BLUE}Action Packer Status${NC}"
    echo "─────────────────────"
    
    case "$OS_TYPE" in
        macos)
            if launchctl list | grep -q "$MACOS_PLIST_NAME"; then
                PID=$(launchctl list | grep "$MACOS_PLIST_NAME" | awk '{print $1}')
                if [ "$PID" = "-" ]; then
                    echo -e "Status: ${YELLOW}Loaded but not running${NC}"
                else
                    echo -e "Status: ${GREEN}Running${NC} (PID: $PID)"
                fi
            else
                echo -e "Status: ${RED}Not loaded${NC}"
            fi
            
            echo ""
            echo "Log files:"
            echo "  stdout: $HOME/Library/Logs/ActionPacker/stdout.log"
            echo "  stderr: $HOME/Library/Logs/ActionPacker/stderr.log"
            ;;
        linux)
            sudo systemctl status "$LINUX_SERVICE_NAME" --no-pager
            ;;
    esac
}

# Show logs
show_logs() {
    check_installed
    
    case "$OS_TYPE" in
        macos)
            LOG_FILE="$HOME/Library/Logs/ActionPacker/stdout.log"
            if [ -f "$LOG_FILE" ]; then
                echo -e "${BLUE}Showing logs (Ctrl+C to exit)...${NC}"
                tail -f "$LOG_FILE"
            else
                print_error "Log file not found: $LOG_FILE"
                exit 1
            fi
            ;;
        linux)
            echo -e "${BLUE}Showing logs (Ctrl+C to exit)...${NC}"
            sudo journalctl -u "$LINUX_SERVICE_NAME" -f
            ;;
    esac
}

# Show help
show_help() {
    echo "Action Packer Service Control"
    echo ""
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  start     Start the service"
    echo "  stop      Stop the service"
    echo "  restart   Restart the service"
    echo "  status    Show service status"
    echo "  logs      Follow log output"
    echo "  help      Show this help message"
    echo ""
}

# Main
case "${1:-help}" in
    start)   start_service ;;
    stop)    stop_service ;;
    restart) restart_service ;;
    status)  show_status ;;
    logs)    show_logs ;;
    help)    show_help ;;
    *)
        print_error "Unknown command: $1"
        echo ""
        show_help
        exit 1
        ;;
esac
