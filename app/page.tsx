import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <h1 className="text-3xl font-semibold">EviStreams</h1>
      <p className="mt-4 text-lg">Human-in-the-loop data extraction for systematic reviews.</p>
      <p className="mt-4 text-gray-600 dark:text-gray-300">Create a form, approve its extraction plan, refine a pilot, and review source-backed results with your team.</p>
      <div className="mt-8 flex gap-6">
        <Link className="underline" href="/login">Sign in</Link>
        <Link className="underline" href="/register">Create an account</Link>
        <a className="underline" href="https://arxiv.org/abs/2609.27418">Read the paper</a>
      </div>
    </main>
  );
}
