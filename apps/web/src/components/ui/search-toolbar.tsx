'use client';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Input } from './input';
import { Button } from './button';
/**
 * The search box on its own, for a toolbar that holds other things. It keeps
 * what is typed until it is submitted, so key it by `search` to follow a
 * search that changes elsewhere.
 */
export function SearchForm({
  search,
  onSearch,
  placeholder = 'Search…',
}: {
  search: string;
  onSearch: (value: string) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(search);
  return (
    <form
      className="search-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(text);
      }}
    >
      <Input
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button variant="outline" type="submit" aria-label="Search">
        <Search size={17} />
      </Button>
    </form>
  );
}
export function SearchToolbar({
  children,
  ...search
}: ComponentProps<typeof SearchForm> & { children?: ReactNode }) {
  return (
    <div className="toolbar">
      <SearchForm {...search} />
      {children}
    </div>
  );
}
