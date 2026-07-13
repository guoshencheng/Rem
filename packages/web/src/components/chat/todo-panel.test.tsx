/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TodoPanel } from './todo-panel';

describe('TodoPanel', () => {
  it('renders todos with status and priority', () => {
    render(
      <TodoPanel
        todos={[
          { content: 'Design DB', status: 'in_progress', priority: 'high' },
          { content: 'Write tests', status: 'pending', priority: 'medium' },
          { content: 'Done', status: 'completed', priority: 'low' },
        ]}
      />,
    );

    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Design DB')).toBeInTheDocument();
    expect(screen.getByText('in_progress')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByText('2 pending')).toBeInTheDocument();
  });

  it('returns null when todos are empty', () => {
    const { container } = render(<TodoPanel todos={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
