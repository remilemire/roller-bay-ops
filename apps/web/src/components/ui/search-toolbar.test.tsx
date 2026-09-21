import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { SearchForm } from './search-toolbar';

// Stands in for a screen that keeps the search in the URL and trims it.
function Harness({ onSearch }: { onSearch: (value: string) => void }) {
  const [search, setSearch] = useState('');
  return (
    <>
      <SearchForm
        search={search}
        onSearch={(value) => {
          onSearch(value);
          setSearch(value.trim());
        }}
      />
      <button onClick={() => setSearch('linen')}>Elsewhere</button>
    </>
  );
}

it('searches once the typing pauses, and at once on Enter', async () => {
  const onSearch = vi.fn();
  const user = userEvent.setup();
  render(<Harness onSearch={onSearch} />);
  const box = screen.getByRole('searchbox');

  await user.type(box, 'sheer ');
  expect(onSearch).not.toHaveBeenCalled();
  await waitFor(() => expect(onSearch).toHaveBeenCalledWith('sheer '));
  expect(onSearch).toHaveBeenCalledTimes(1);
  // The trimmed echo neither replaces the text nor takes the focus away.
  expect(box).toHaveValue('sheer ');
  expect(box).toHaveFocus();

  await user.type(box, 'voile{Enter}');
  expect(onSearch).toHaveBeenLastCalledWith('sheer voile');
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(onSearch).toHaveBeenCalledTimes(2);
});

it('follows a search changed elsewhere', async () => {
  const user = userEvent.setup();
  render(<Harness onSearch={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
  expect(screen.getByRole('searchbox')).toHaveValue('linen');
});
