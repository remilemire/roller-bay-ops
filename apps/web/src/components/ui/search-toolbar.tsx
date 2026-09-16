'use client';
import { useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Input } from './input';
import { Button } from './button';
export function SearchToolbar({
  search,
  onSearch,
  placeholder = 'Search…',
  children,
}: {
  search: string;
  onSearch: (value: string) => void;
  placeholder?: string;
  children?: ReactNode;
}) {
  const [text, setText] = useState(search);
  return (
    <div className="toolbar">
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
      {children}
    </div>
  );
}
