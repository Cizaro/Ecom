import Link from "next/link";

// Shown with HTTP 403 when a signed-in user lacks the permission a page needs.
export default function Forbidden() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-4">
      <h1 className="text-2xl font-semibold tracking-tight">You do not have access to this page</h1>
      <p className="text-neutral-600">
        Your role in this store does not include it. Ask the store owner if you need access.
      </p>
      <Link href="/admin" className="font-medium underline underline-offset-4">
        Back to the admin home
      </Link>
    </main>
  );
}
