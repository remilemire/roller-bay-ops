import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { EmployeeSelection } from './employee-selection';
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(),
}));
const employees = [
  {
    id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Alex Reed',
    initials: 'AR',
  },
  {
    id: '22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Robin Park',
    initials: 'RP',
  },
].map((e) => ({
  ...e,
  isActive: true,
  linkedUserId: null,
  revision: 1,
  createdAt: '2026-09-01T00:00:00.000Z',
}));
function Harness({ onChange }: { onChange: (ids: string[]) => void }) {
  const [value, setValue] = useState<string[]>([]);
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <EmployeeSelection
        value={value}
        onChange={(ids) => {
          setValue(ids);
          onChange(ids);
        }}
      />
    </QueryClientProvider>
  );
}
beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(api).mockResolvedValue(employees);
});
it('adds employees by search, lists each once, and removes them again', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  const box = screen.getByRole('combobox', { name: 'Completed by' });
  await user.click(box);
  expect(await screen.findAllByRole('option')).toHaveLength(2);
  await user.type(box, 'rp');
  // The search is debounced; wait for the list to narrow before choosing.
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
  expect(
    screen.getByRole('option', { name: 'Robin Park — RP' }),
  ).toBeInTheDocument();
  await user.keyboard('{Enter}');
  expect(onChange).toHaveBeenLastCalledWith([employees[1]!.id]);
  expect(
    screen.getByRole('button', { name: 'Remove Robin Park' }),
  ).toBeInTheDocument();
  // A chosen employee is not offered again; the box is ready for another.
  await user.click(box);
  expect(await screen.findAllByRole('option')).toHaveLength(1);
  await user.click(screen.getByRole('option', { name: 'Alex Reed — AR' }));
  expect(onChange).toHaveBeenLastCalledWith([
    employees[1]!.id,
    employees[0]!.id,
  ]);
  await user.click(screen.getByRole('button', { name: 'Remove Robin Park' }));
  expect(onChange).toHaveBeenLastCalledWith([employees[0]!.id]);
  expect(
    screen.queryByRole('button', { name: 'Remove Robin Park' }),
  ).not.toBeInTheDocument();
});
