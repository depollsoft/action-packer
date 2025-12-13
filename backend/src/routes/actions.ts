import { Router, Request, Response } from 'express';

const router = Router();

// Mock data for GitHub Actions
interface Action {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'failed' | 'queued';
  workflow: string;
  startedAt: string;
  completedAt?: string;
  duration?: number;
}

const mockActions: Action[] = [
  {
    id: '1',
    name: 'Build and Test',
    status: 'completed',
    workflow: 'CI',
    startedAt: new Date(Date.now() - 3600000).toISOString(),
    completedAt: new Date(Date.now() - 3000000).toISOString(),
    duration: 600,
  },
  {
    id: '2',
    name: 'Deploy to Production',
    status: 'running',
    workflow: 'CD',
    startedAt: new Date(Date.now() - 300000).toISOString(),
  },
  {
    id: '3',
    name: 'Lint Code',
    status: 'completed',
    workflow: 'CI',
    startedAt: new Date(Date.now() - 7200000).toISOString(),
    completedAt: new Date(Date.now() - 7000000).toISOString(),
    duration: 120,
  },
];

// GET all actions
router.get('/', (req: Request, res: Response) => {
  res.json(mockActions);
});

// GET action by ID
router.get('/:id', (req: Request, res: Response) => {
  const action = mockActions.find(a => a.id === req.params.id);
  if (!action) {
    return res.status(404).json({ error: 'Action not found' });
  }
  res.json(action);
});

// POST create new action (mock)
router.post('/', (req: Request, res: Response) => {
  const newAction: Action = {
    id: String(mockActions.length + 1),
    name: req.body.name || 'New Action',
    status: 'queued',
    workflow: req.body.workflow || 'Default',
    startedAt: new Date().toISOString(),
  };
  mockActions.push(newAction);
  res.status(201).json(newAction);
});

// DELETE action by ID (mock)
router.delete('/:id', (req: Request, res: Response) => {
  const index = mockActions.findIndex(a => a.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Action not found' });
  }
  mockActions.splice(index, 1);
  res.status(204).send();
});

export { router as actionsRouter };
