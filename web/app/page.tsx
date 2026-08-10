"use client";
import { useRouter } from "next/navigation";
import { PERSONAS } from "@/lib/api";

// The login stub. Not real auth — the point of the demo is what happens AFTER
// login: the same app changes shape per department, and the boundary is
// enforced by Postgres grants, not by this page.
export default function Home() {
  const router = useRouter();
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
          Unified Data Platform
        </h1>
        <p className="text-sm text-neutral-500">
          One database. Each department sees only its own views — enforced by
          Postgres roles and grants, not by application code. Pick a persona to
          see the app take that department&apos;s shape.
        </p>
        <p className="inline-block rounded-full bg-amber-100 dark:bg-amber-950 px-3 py-1 text-xs font-medium text-amber-900 dark:text-amber-200">
          Illustrative demo — all data synthetic
        </p>
      </div>
      <div className="grid gap-3">
        {PERSONAS.map((p) => (
          <button
            key={p.token}
            onClick={() => {
              localStorage.setItem("demo_token", p.token);
              router.push("/dashboard");
            }}
            className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 text-left hover:border-neutral-400 dark:hover:border-neutral-600 transition-colors"
          >
            <p className="font-medium text-neutral-900 dark:text-neutral-100">{p.label}</p>
            <p className="text-sm text-neutral-500">{p.description}</p>
          </button>
        ))}
      </div>
    </main>
  );
}
