import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('renders the Action Packer app', () => {
    render(<App />);
    expect(screen.getByText(/Action Packer/i)).toBeInTheDocument();
  });
  
  it('renders the sidebar navigation', () => {
    render(<App />);
    // Check navigation items exist
    const nav = screen.getByRole('navigation');
    expect(nav).toBeInTheDocument();
    // Verify key navigation labels are present
    expect(screen.getAllByText(/Dashboard/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Credentials/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Runners/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Settings/i)).toBeInTheDocument();
  });
});
