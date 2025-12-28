# Action Packer

Self-hostable web UI for managing GitHub Actions running locally on-machine.

> **⚠️ Experimental personal project — under active development**

## Tech Stack

- **Backend**: Node.js + Express + TypeScript (via `tsx`)
- **Frontend**: React + TypeScript + Vite
- **Testing**: Vitest + Supertest
- **CI/CD**: GitHub Actions

## Quick Start

### Prerequisites

- Node.js 20+ (22+ recommended)
- npm 10+
- Docker (for runner management)

### Automated Installation (Recommended)

The easiest way to install Action Packer as a service that runs at startup:

#### macOS / Linux

```bash
# Clone the repository
git clone https://github.com/depoll/action-packer.git
cd action-packer

# Run the installer
./scripts/install.sh
```

**Options:**
```bash
./scripts/install.sh --port 3001      # Set server port
./scripts/install.sh --env production # Set NODE_ENV
./scripts/install.sh --help           # Show all options
```

#### Windows (PowerShell)

```powershell
# Clone the repository
git clone https://github.com/depoll/action-packer.git
cd action-packer

# Run the installer (may need to allow script execution first)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
.\scripts\install.ps1
```

**Options:**
```powershell
.\scripts\install.ps1 -Port 3001 -Environment production
```

This will:
- Install all npm dependencies
- Build the project for production
- Create a `.env` configuration file
- Set up the service to start automatically on boot/login
- Start the service immediately

### Service Management

After installation, use the service control script:

#### macOS / Linux

```bash
./scripts/service.sh status   # Check if running
./scripts/service.sh start    # Start the service
./scripts/service.sh stop     # Stop the service
./scripts/service.sh restart  # Restart the service
./scripts/service.sh logs     # Follow log output
```

#### Windows (PowerShell)

```powershell
.\scripts\service.ps1 status   # Check if running
.\scripts\service.ps1 start    # Start the service
.\scripts\service.ps1 stop     # Stop the service
.\scripts\service.ps1 restart  # Restart the service
.\scripts\service.ps1 logs     # Follow log output
```

### Uninstallation

To remove the service:

#### macOS / Linux
```bash
./scripts/uninstall.sh
```

#### Windows (PowerShell)
```powershell
.\scripts\uninstall.ps1
```

### Manual Installation

If you prefer manual setup:

```bash
# Clone the repository
git clone https://github.com/depoll/action-packer.git
cd action-packer

# Install dependencies
npm install

# Build for production
npm run build

# Start the server
npm start
```

### Development

```bash
# Start both frontend and backend
npm run dev

# Or run individually
npm run dev:backend   # API at http://localhost:3001
npm run dev:frontend  # UI at http://localhost:5173
```

`npm run dev` uses `concurrently` to run both dev servers in parallel.
Press Ctrl+C once to stop both.

### Testing

```bash
# Run all tests
npm test

# Run tests for specific workspace
npm test -w backend
npm test -w frontend
```

### Building

```bash
# Build all packages
npm run build

# Type-check without emitting
npm run typecheck
```

## Project Structure

```text
action-packer/
├── backend/           # Express API server
│   ├── src/
│   │   ├── index.ts
│   │   ├── routes/
│   │   └── middleware/
│   └── tests/
├── frontend/          # React SPA (Vite)
│   ├── src/
│   └── public/
├── .github/workflows/ # CI pipelines
├── AGENTS.md          # AI assistant guidance
└── package.json       # Workspace root
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check with uptime |
| GET | `/api` | API info |

## Platform Support

### macOS
- Uses **launchd** to run the service at login
- Logs stored in `~/Library/Logs/ActionPacker/`
- Service plist at `~/Library/LaunchAgents/com.action-packer.server.plist`

### Linux
- Uses **systemd** to run the service at boot
- Requires sudo for service installation
- Logs accessible via `journalctl -u action-packer`

### Windows
- Uses **Task Scheduler** to run the service at login
- Logs stored in `%LOCALAPPDATA%\ActionPacker\Logs\`
- Task named `ActionPacker` in Task Scheduler

## Configuration

After installation, edit `backend/.env` to configure:

```bash
# Server
PORT=3001
NODE_ENV=production

# GitHub App (required for GitHub integration)
GITHUB_APP_ID=your_app_id
GITHUB_APP_PRIVATE_KEY_PATH=/path/to/private-key.pem  # Windows: C:\path\to\private-key.pem
GITHUB_APP_CLIENT_ID=your_client_id
GITHUB_APP_CLIENT_SECRET=your_client_secret

# Session
JWT_SECRET=your_secure_random_string
```

After changing configuration, restart the service:
```bash
# macOS/Linux
./scripts/service.sh restart

# Windows (PowerShell)
.\scripts\service.ps1 restart
```

## Documentation

- [macOS Runner Isolation Options](docs/macos-runner-isolation-options.md) - Research on isolation technologies for running multiple concurrent runners on macOS

## Contributing

This is an experimental personal project, but contributions are welcome!

## License

See [LICENSE](LICENSE) for details.
