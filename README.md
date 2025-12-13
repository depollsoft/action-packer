# Action Packer

Self-hostable web UI for managing GitHub Actions running locally on-machine. 

> **Experimental personal project -- under development**

## Features

- 🚀 Modern Node.js/Express backend with TypeScript
- ⚛️ React-based frontend with TypeScript and Vite
- 🎨 Clean, responsive UI for managing actions and workflows
- 🧪 Full test coverage with Jest (backend) and Vitest (frontend)
- 🔄 CI/CD pipeline with GitHub Actions
- 📦 Monorepo structure with npm workspaces

## Prerequisites

- Node.js 20.x or later
- npm 10.x or later

## Getting Started

### Installation

```bash
# Clone the repository
git clone https://github.com/depoll/action-packer.git
cd action-packer

# Install dependencies
npm install
```

### Development

Start both backend and frontend in development mode:

```bash
npm run dev
```

Or run them separately:

```bash
# Backend only (runs on http://localhost:3001)
npm run dev --workspace=backend

# Frontend only (runs on http://localhost:3000)
npm run dev --workspace=frontend
```

### Building

Build both backend and frontend:

```bash
npm run build
```

Or build separately:

```bash
# Backend only
npm run build --workspace=backend

# Frontend only
npm run build --workspace=frontend
```

### Testing

Run all tests:

```bash
npm test
```

Run tests for individual workspaces:

```bash
# Backend tests
npm run test --workspace=backend

# Frontend tests
npm run test --workspace=frontend
```

### Production

```bash
# Build the project
npm run build

# Start the backend server
npm start
```

The backend will serve on port 3001 by default. You can configure this with the `PORT` environment variable.

## Project Structure

```
action-packer/
├── backend/              # Express TypeScript backend
│   ├── src/
│   │   ├── index.ts      # Main server entry point
│   │   └── routes/       # API routes
│   ├── tests/            # Backend tests
│   ├── tsconfig.json     # TypeScript config
│   └── package.json
├── frontend/             # React TypeScript frontend
│   ├── src/
│   │   ├── components/   # React components
│   │   ├── services/     # API services
│   │   ├── App.tsx       # Main app component
│   │   └── main.tsx      # Entry point
│   ├── index.html        # HTML template
│   ├── vite.config.ts    # Vite config
│   └── package.json
├── .github/
│   └── workflows/        # CI/CD workflows
└── package.json          # Root package config
```

## API Endpoints

### Actions

- `GET /api/actions` - Get all actions
- `GET /api/actions/:id` - Get action by ID
- `POST /api/actions` - Create new action
- `DELETE /api/actions/:id` - Delete action

### Workflows

- `GET /api/workflows` - Get all workflows
- `GET /api/workflows/:id` - Get workflow by ID
- `POST /api/workflows` - Create new workflow
- `PATCH /api/workflows/:id` - Update workflow
- `DELETE /api/workflows/:id` - Delete workflow

### Health Check

- `GET /api/health` - Health check endpoint

## Technologies

### Backend
- **Node.js** with native TypeScript support
- **Express.js** for REST API
- **TypeScript** for type safety
- **Jest** for testing
- **CORS** for cross-origin requests

### Frontend
- **React 18** with TypeScript
- **Vite** for fast development and building
- **Vitest** for testing
- **Testing Library** for component testing

## License

ISC
