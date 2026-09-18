import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StockEditor } from './stock-editor';

vi.mock('@/features/auth/auth-boundary', async () => {
  const { defaultMeasurementUnits } = await import('@roller-bay/shared/users');
  return {
    useCurrentUser: () => ({
      id: 'user-1',
      measurementUnits: defaultMeasurementUnits,
    }),
  };
});
vi.mock('@/components/ui/lookup', () => ({
  Lookup: ({ label, error }: { label: string; error?: string }) => (
    <div>
      {label}
      {error && <small>{`${label}: ${error}`}</small>}
    </div>
  ),
}));

it('shows rejected values beside their fields and clears one once it is edited', async () => {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <StockEditor close={vi.fn()} />
    </QueryClientProvider>,
  );
  const width = screen.getByLabelText('Width (in)');
  await user.type(width, '0');
  await user.type(screen.getByLabelText('Initial length (yd)'), '30');
  await user.click(screen.getByRole('button', { name: 'Save stock item' }));
  expect(await screen.findByText('Location: Invalid.')).toBeInTheDocument();
  expect(width).toBeInvalid();
  expect(width).toHaveAccessibleDescription('Too small.');
  const notice = screen.getByRole('alert');
  expect(notice).toHaveTextContent('Some fields are missing or invalid.');
  expect(notice).not.toHaveTextContent(/width|location/i);
  await user.type(width, '54');
  expect(width).not.toBeInvalid();
});
