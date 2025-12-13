import { Router } from 'express';

export const apiRouter = Router();

// Example endpoint
apiRouter.get('/', (_req, res) => {
  res.json({
    message: 'Welcome to the Action Packer API',
    version: '1.0.0',
  });
});

// Add more API routes here
// apiRouter.use('/users', usersRouter);
// apiRouter.use('/items', itemsRouter);
