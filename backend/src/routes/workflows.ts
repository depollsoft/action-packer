import { Router, Request, Response } from 'express';

const router = Router();

// Mock data for workflows
interface Workflow {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  lastRun?: string;
  triggers: string[];
}

const mockWorkflows: Workflow[] = [
  {
    id: '1',
    name: 'CI Pipeline',
    description: 'Build, test, and lint the codebase',
    enabled: true,
    lastRun: new Date(Date.now() - 3600000).toISOString(),
    triggers: ['push', 'pull_request'],
  },
  {
    id: '2',
    name: 'CD Pipeline',
    description: 'Deploy to production',
    enabled: true,
    lastRun: new Date(Date.now() - 86400000).toISOString(),
    triggers: ['push'],
  },
  {
    id: '3',
    name: 'Nightly Tests',
    description: 'Run comprehensive test suite',
    enabled: false,
    triggers: ['schedule'],
  },
];

// GET all workflows
router.get('/', (req: Request, res: Response) => {
  res.json(mockWorkflows);
});

// GET workflow by ID
router.get('/:id', (req: Request, res: Response) => {
  const workflow = mockWorkflows.find(w => w.id === req.params.id);
  if (!workflow) {
    return res.status(404).json({ error: 'Workflow not found' });
  }
  res.json(workflow);
});

// POST create new workflow (mock)
router.post('/', (req: Request, res: Response) => {
  const newWorkflow: Workflow = {
    id: String(mockWorkflows.length + 1),
    name: req.body.name || 'New Workflow',
    description: req.body.description || '',
    enabled: req.body.enabled ?? true,
    triggers: req.body.triggers || ['push'],
  };
  mockWorkflows.push(newWorkflow);
  res.status(201).json(newWorkflow);
});

// PATCH update workflow (mock)
router.patch('/:id', (req: Request, res: Response) => {
  const workflow = mockWorkflows.find(w => w.id === req.params.id);
  if (!workflow) {
    return res.status(404).json({ error: 'Workflow not found' });
  }
  
  if (req.body.name !== undefined) workflow.name = req.body.name;
  if (req.body.description !== undefined) workflow.description = req.body.description;
  if (req.body.enabled !== undefined) workflow.enabled = req.body.enabled;
  if (req.body.triggers !== undefined) workflow.triggers = req.body.triggers;
  
  res.json(workflow);
});

// DELETE workflow by ID (mock)
router.delete('/:id', (req: Request, res: Response) => {
  const index = mockWorkflows.findIndex(w => w.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Workflow not found' });
  }
  mockWorkflows.splice(index, 1);
  res.status(204).send();
});

export { router as workflowsRouter };
