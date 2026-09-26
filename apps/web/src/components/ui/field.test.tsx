import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextField } from './field';

it('labels the input and describes it with the tooltip text', async () => {
  const user = userEvent.setup();
  render(
    <TextField
      label="Radial depth (mm)"
      value=""
      onChange={() => {}}
      help="Distance from the tube surface."
    />,
  );
  const input = screen.getByLabelText('Radial depth (mm)');
  expect(input).toHaveAccessibleDescription('Distance from the tube surface.');
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

  await user.tab();
  expect(
    screen.getByRole('button', { name: 'More information' }),
  ).toHaveFocus();
  expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent(
    'Distance from the tube surface.',
  );
  await user.keyboard('{Escape}');
  expect(
    screen.queryByRole('tooltip', { hidden: true }),
  ).not.toBeInTheDocument();
});

it('marks an optional field without changing its accessible name', () => {
  render(<TextField label="Note" value="" onChange={() => {}} optional />);
  expect(screen.getByLabelText('Note')).not.toBeRequired();
  expect(screen.getByText('Optional')).toBeInTheDocument();
});
