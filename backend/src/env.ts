import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load environment variables from a .env file if present.
// This supports running via npm workspaces where the backend's CWD may be
// either the repo root or backend/.
//
// NOTE: This does not override already-set environment variables.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const candidates = [
  path.resolve(process.cwd(), '.env'),
  // backend/.env
  path.resolve(__dirname, '..', '.env'),
  // repo-root/.env (backend/src -> ../../.env, backend/dist -> ../../.env)
  path.resolve(__dirname, '..', '..', '.env'),
];

for (const envPath of candidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}
