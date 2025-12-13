import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ActionsList } from '../components/ActionsList';
import { Action } from '../App';

describe('ActionsList', () => {
  it('renders empty state when no actions', () => {
    render(<ActionsList actions={[]} />);
    expect(screen.getByText('No actions found')).toBeInTheDocument();
  });

  it('renders actions when provided', () => {
    const actions: Action[] = [
      {
        id: '1',
        name: 'Test Action',
        status: 'completed',
        workflow: 'CI',
        startedAt: new Date().toISOString(),
        duration: 120,
      },
    ];
    render(<ActionsList actions={actions} />);
    expect(screen.getByText('Test Action')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('CI')).toBeInTheDocument();
  });
});
