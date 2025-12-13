import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '../App';

describe('App', () => {
  it('renders the app header', () => {
    render(<App />);
    expect(screen.getByText('Action Packer')).toBeInTheDocument();
    expect(screen.getByText('GitHub Actions Manager')).toBeInTheDocument();
  });

  it('renders tabs', () => {
    render(<App />);
    expect(screen.getByText('Actions')).toBeInTheDocument();
    expect(screen.getByText('Workflows')).toBeInTheDocument();
  });
});
