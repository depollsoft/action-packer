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

### Installation

```bash
# Clone the repository
git clone https://github.com/depoll/action-packer.git
cd action-packer

# Install dependencies
npm install
```

### Development

```bash
# Start both frontend and backend
npm run dev

# Or run individually
npm run dev:backend   # API at http://localhost:3001
npm run dev:frontend  # UI at http://localhost:5173
```

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

## Contributing

This is an experimental personal project, but contributions are welcome!

## License

See [LICENSE](LICENSE) for details.
