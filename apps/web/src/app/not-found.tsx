import Link from "next/link";

// 404 for unknown pages, records in another tenant, and host names that no
// store answers to.
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-4">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-ink-muted">The page you are looking for does not exist or has moved.</p>
      <Link href="/" className="font-medium underline underline-offset-4">
        Go to the home page
      </Link>
    </main>
  );
}
