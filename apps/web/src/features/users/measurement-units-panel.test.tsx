import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { user } from '../../../tests/fixtures';
import { sessionKey } from '@/features/auth/auth.queries';
import { MeasurementUnitsPanel } from './measurement-units-panel';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(sessionKey, user);
  render(
    <QueryClientProvider client={client}>
      <MeasurementUnitsPanel />
    </QueryClientProvider>,
  );
  return client;
}

it('saves one field at a time and shows the units the server returns', async () => {
  const updated = {
    ...user,
    measurementUnits: { ...user.measurementUnits, blindWidth: 'mm' },
  };
  const fetchMock = vi.fn().mockResolvedValue(json(updated));
  vi.stubGlobal('fetch', fetchMock);
  const client = renderPanel();
  const select = screen.getByLabelText('Blind width');
  expect(select).toHaveValue('in');
  await userEvent.selectOptions(select, 'mm');
  await waitFor(() =>
    expect(screen.getByLabelText('Blind width')).toHaveValue('mm'),
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toMatch(/\/users\/me\/measurement-units$/);
  expect(init.method).toBe('PATCH');
  expect(JSON.parse(init.body as string)).toEqual({ blindWidth: 'mm' });
  expect(client.getQueryData(sessionKey)).toEqual(updated);
  expect(screen.getByLabelText('Roll width')).toHaveValue('in');
  expect(screen.getByText('Millimetres, multiples of 5')).toBeInTheDocument();
});

it('keeps the saved unit and reports the error when saving fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(json({ message: 'Temporarily unavailable' }, 503)),
  );
  const client = renderPanel();
  await userEvent.selectOptions(screen.getByLabelText('Roll length'), 'm');
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Temporarily unavailable',
  );
  expect(screen.getByLabelText('Roll length')).toHaveValue('yd');
  expect(client.getQueryData(sessionKey)).toEqual(user);
});
