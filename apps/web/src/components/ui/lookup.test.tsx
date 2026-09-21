import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Dialog } from './dialog';
import { Lookup } from './lookup';

const colors = [
  { id: 'a1', label: 'C1-000 · Linen voile' },
  { id: 'b2', label: 'C2-000 · Linen voile' },
  { id: 'c3', label: 'S3-000 · Sheer' },
];
function Harness({
  initial = '',
  load,
  onChange = () => {},
  after,
  create,
}: {
  initial?: string;
  load: (search: string) => Promise<{ items: typeof colors; total: number }>;
  onChange?: (value: string) => void;
  after?: React.ReactNode;
  create?: React.ComponentProps<typeof Lookup>['create'];
}) {
  const [value, setValue] = useState(initial);
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <Lookup
        label="Fabric color"
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        queryKey={['colors']}
        load={load}
        create={create}
      />
      {after}
    </QueryClientProvider>
  );
}
const filtering = vi.fn(async (search: string) => {
  const items = colors.filter((c) =>
    c.label.toLowerCase().includes(search.toLowerCase()),
  );
  return { items, total: items.length };
});

it('searches as you type, picks with the keyboard and shows the pick by its label', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness load={filtering} onChange={onChange} />);
  const box = screen.getByRole('combobox', { name: 'Fabric color' });
  await user.click(box);
  expect(await screen.findAllByRole('option')).toHaveLength(3);
  await user.type(box, 'linen');
  await waitFor(() =>
    expect(filtering).toHaveBeenCalledWith('linen', 1, expect.anything()),
  );
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
  await user.keyboard('{ArrowDown}{Enter}');
  expect(onChange).toHaveBeenCalledWith('b2');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(box).toHaveValue('C2-000 · Linen voile');
  // Typing into the closed box searches with the new text only, and the
  // selection shows faded as the placeholder meanwhile.
  await user.type(box, 'sheer');
  expect(box).toHaveValue('sheer');
  expect(box).toHaveAttribute('placeholder', 'C2-000 · Linen voile');
  await waitFor(() =>
    expect(filtering).toHaveBeenCalledWith('sheer', 1, expect.anything()),
  );
  await user.click(
    await screen.findByRole('option', { name: 'S3-000 · Sheer' }),
  );
  expect(onChange).toHaveBeenLastCalledWith('c3');
  expect(box).toHaveValue('S3-000 · Sheer');
  // Backspace on the shown selection removes it instead of editing its label.
  await user.keyboard('{Backspace}');
  expect(onChange).toHaveBeenLastCalledWith('');
  expect(box).toHaveValue('');
  await user.click(
    await screen.findByRole('option', { name: 'S3-000 · Sheer' }),
  );
  await user.click(screen.getByRole('button', { name: 'Clear Fabric color' }));
  expect(onChange).toHaveBeenLastCalledWith('');
  expect(box).toHaveFocus();
});

it('labels a saved value from the loaded page, falls back to its id, and says when more matches exist', async () => {
  const user = userEvent.setup();
  const { unmount } = render(
    <Harness initial="b2" load={async () => ({ items: colors, total: 40 })} />,
  );
  const box = screen.getByRole('combobox', { name: 'Fabric color' });
  await waitFor(() => expect(box).toHaveValue('C2-000 · Linen voile'));
  await user.click(box);
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Showing 3 of 40 matches',
  );
  expect(
    screen.getByRole('option', { name: 'C2-000 · Linen voile' }),
  ).toHaveAttribute('aria-selected', 'true');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(box).toHaveValue('C2-000 · Linen voile');
  unmount();
  render(
    <Harness
      initial="ffffffff-0000-4000-8000-000000000000"
      load={async () => ({ items: colors, total: 3 })}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Fabric color' })).toHaveValue(
      'Selected · FFFFFFFF',
    ),
  );
});

it('walks the options with Tab and leaves the field past the last one', async () => {
  const user = userEvent.setup();
  render(
    <Harness
      load={async () => ({ items: colors, total: 3 })}
      after={<button type="button">Next field</button>}
    />,
  );
  const box = screen.getByRole('combobox', { name: 'Fabric color' });
  await user.click(box);
  const options = await screen.findAllByRole('option');
  expect(box).toHaveAttribute('aria-activedescendant', options[0]!.id);
  await user.tab();
  expect(box).toHaveFocus();
  expect(box).toHaveAttribute('aria-activedescendant', options[1]!.id);
  await user.tab({ shift: true });
  expect(box).toHaveAttribute('aria-activedescendant', options[0]!.id);
  await user.tab();
  await user.tab();
  expect(box).toHaveAttribute('aria-activedescendant', options[2]!.id);
  await user.tab();
  expect(screen.getByRole('button', { name: 'Next field' })).toHaveFocus();
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

it('lets Escape close an open list inside a dialog before it closes the dialog', async () => {
  const user = userEvent.setup();
  const onOpenChange = vi.fn();
  render(
    <Dialog open onOpenChange={onOpenChange} title="Edit">
      <Harness load={async () => ({ items: colors, total: 3 })} />
    </Dialog>,
  );
  const box = screen.getByRole('combobox', { name: 'Fabric color' });
  await user.click(box);
  await screen.findByRole('listbox');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(onOpenChange).not.toHaveBeenCalled();
  await user.keyboard('{Escape}');
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('offers to create what was typed as an option of its own, and does nothing until it is picked', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const run = vi
    .fn<(term: string) => Promise<{ id: string; label: string }>>()
    .mockRejectedValueOnce(new Error('A color with this code already exists.'))
    .mockImplementation(async (term) => ({ id: 'new', label: term }));
  render(
    <Harness
      load={filtering}
      onChange={onChange}
      create={{
        // Only a whole code that matches nothing can be created.
        label: (term, items) =>
          /^[A-Z]\d-\d{3}$/.test(term) && !items.length
            ? `Create ${term}`
            : null,
        run,
      }}
    />,
  );
  const box = screen.getByRole('combobox', { name: 'Fabric color' });
  await user.type(box, 'C1');
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
  expect(screen.queryByRole('option', { name: /Create/ })).toBeNull();
  await user.type(box, '-999');
  const option = await screen.findByRole('option', { name: 'Create C1-999' });
  // Typing alone creates nothing.
  expect(run).not.toHaveBeenCalled();
  await user.click(option);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'A color with this code already exists.',
  );
  expect(onChange).not.toHaveBeenCalled();
  await user.click(screen.getByRole('option', { name: 'Create C1-999' }));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith('new'));
  expect(run).toHaveBeenLastCalledWith('C1-999');
  expect(box).toHaveValue('C1-999');
});
