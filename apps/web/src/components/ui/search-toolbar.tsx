'use client';
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { Search } from 'lucide-react';
import { Input } from './input';
import { Button } from './button';

// Long enough that a word typed at speed makes one request, short enough to
// read as instant.
const SEARCH_DELAY_MS = 300;

/**
 * The search box on its own, for a toolbar that holds other things. It
 * searches as the user types, after a short pause, and at once on Enter.
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
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState(search);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // A delayed search must apply to the page as it is then, not as it was
  // when the key was pressed.
  const latest = useRef(onSearch);
  useEffect(() => {
    latest.current = onSearch;
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  // Follow a search changed elsewhere, such as by a link, but not the echo of
  // what is being typed: the screen may trim it, and replacing the text would
  // move the caret or drop a trailing space mid-word.
  if (search !== shown) {
    setShown(search);
    if (!editing) setText(search);
  }

  const submit = (value: string) => {
    clearTimeout(timer.current);
    timer.current = undefined;
    latest.current(value);
  };
  return (
    <form
      className="search-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit(text);
      }}
    >
      <Input
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={text}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          if (timer.current) submit(text);
        }}
        onChange={(e) => {
          const value = e.target.value;
          setText(value);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => submit(value), SEARCH_DELAY_MS);
        }}
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
