import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="empty">
      <h1>That page isn’t here.</h1>
      <p>It may have moved or no longer exist.</p>
      <Link className="text-link" href="/">
        Back to your workspace →
      </Link>
    </main>
  );
}
