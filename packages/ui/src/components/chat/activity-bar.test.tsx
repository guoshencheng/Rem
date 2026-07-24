/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityBar } from './activity-bar';

describe('ActivityBar', () => {
  it('returns null when idle and showIdle is false', () => {
    const { container } = render(<ActivityBar activity="idle" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Idle placeholder when idle and showIdle is true', () => {
    render(<ActivityBar activity="idle" showIdle />);
    expect(screen.getByText('Idle')).toBeInTheDocument();
  });

  it('renders thinking state regardless of showIdle', () => {
    render(<ActivityBar activity="thinking" />);
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });
});
