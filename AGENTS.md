# AGENTS.md

This file provides guidance for AI coding assistants working on the Action Packer project.

## Project Overview

Action Packer is a full-stack TypeScript application with:

- **Backend**: Node.js + Express running TypeScript natively via `tsx`
- **Frontend**: React + TypeScript built with Vite
- **Monorepo**: npm workspaces managing both packages

## Architecture

```text
action-packer/
├── backend/           # Express API server
│   ├── src/
│   │   ├── index.ts          # App entry point, server setup
│   │   ├── routes/           # Express route handlers
│   │   └── middleware/       # Express middleware
│   └── tests/                # Vitest test files
├── frontend/          # React SPA
│   ├── src/
│   │   ├── main.tsx          # React entry point
│   │   ├── App.tsx           # Root component
│   │   └── components/       # React components
│   └── public/               # Static assets
└── .github/workflows/ # CI/CD pipelines
```

## Development Setup

### Prerequisites

- Node.js 20+ (22+ recommended)
- npm 10+

### Quick Start

```bash
# Install all dependencies (root + workspaces)
npm install

# Run both frontend and backend in dev mode
npm run dev

# Or run individually
npm run dev:backend   # http://localhost:3001
npm run dev:frontend  # http://localhost:5173
```

## Code Conventions

### TypeScript

- Strict mode enabled in all packages
- Use ES modules (`import`/`export`)
- Prefer `type` over `interface` for object types unless extending
- Use `.js` extension in imports (required for ESM with NodeNext resolution)

### Backend

- Express routers exported as named exports
- Middleware in dedicated files under `middleware/`
- All routes prefixed appropriately (`/api/*`, `/health`)
- Error handling via centralized middleware

### Frontend

- Functional components with hooks
- Components in PascalCase
- Hooks prefixed with `use`
- Styles colocated or in CSS modules

### Testing

- Vitest for both frontend and backend
- Backend: `supertest` for HTTP testing
- Frontend: `@testing-library/react` for component tests
- Test files: `*.test.ts` or `*.test.tsx`

## Key Commands

| Command | Description |
|---------|-------------|
| `npm install` | Install all workspace dependencies |
| `npm run dev` | Start all dev servers |
| `npm run build` | Build all packages |
| `npm run test` | Run all tests |
| `npm run typecheck` | Type-check all packages |

### Backend-specific

```bash
npm run dev:backend      # Start with hot reload
npm run test -w backend  # Run backend tests only
```

### Frontend-specific

```bash
npm run dev:frontend     # Start Vite dev server
npm run test -w frontend # Run frontend tests only
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check with uptime |
| GET | `/api` | API welcome message |

## Environment Variables

### Backend Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `NODE_ENV` | `development` | Environment mode |

### Frontend Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `http://localhost:3001` | Backend API URL |

## CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`):

- Runs on push to `main` and all PRs
- Tests against Node 20 and 22
- Jobs: type-check → test → build (for each package)

## Common Tasks

### Adding a new API route

1. Create route file in `backend/src/routes/`
2. Export router and mount in `backend/src/index.ts`
3. Add tests in `backend/tests/`

### Adding a new React component

1. Create component in `frontend/src/components/`
2. Export from component file
3. Add tests alongside or in `__tests__/`

### Adding dependencies

```bash
# Backend dependency
npm install <package> -w backend

# Frontend dependency  
npm install <package> -w frontend

# Dev dependency (specify workspace)
npm install -D <package> -w backend
```

## Dependency Management

### Policy: Always Use Latest Versions

This project maintains a policy of using the **latest stable versions** of all dependencies. When adding or updating dependencies:

1. **Always install latest**: Use `npm install <package>@latest` or omit version to get latest
2. **Check for outdated**: Run `npm outdated` regularly to identify stale dependencies
3. **Update all at once**: Use `npm update` or manually bump versions in `package.json`
4. **Verify after updates**: Always run `npm run typecheck && npm test` after updating

### Checking for Updates

```bash
# Check all workspaces for outdated packages
npm outdated

# Update all packages to latest within semver range
npm update

# Update a specific package to latest (may be breaking)
npm install <package>@latest -w backend
npm install <package>@latest -w frontend
```

### Version Pinning Rules

- Use `^` (caret) for most dependencies to allow minor/patch updates
- Use exact versions only when a specific version is required for compatibility
- Avoid `~` (tilde) unless patch-only updates are specifically needed

### Major Version Updates

When updating major versions (e.g., Express 4→5, Vitest 1→3):

1. Read the migration guide/changelog
2. Update types packages to match (e.g., `@types/express@5`)
3. Run typecheck to catch breaking API changes
4. Run full test suite
5. Test manually in dev mode

## Troubleshooting

### ESM Import Issues

Ensure imports include `.js` extension for local files:

```typescript
// ✅ Correct
import { healthRouter } from './routes/health.js';

// ❌ Wrong
import { healthRouter } from './routes/health';
```

### Port conflicts

Backend defaults to 3001, frontend to 5173. Change via:

- Backend: `PORT=4000 npm run dev:backend`
- Frontend: `npm run dev:frontend -- --port 4000`
