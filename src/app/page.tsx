import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-6 py-16">
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-lime-400">
          ArbiShield
        </p>
        <h1 className="mt-2 text-3xl font-bold text-white">arbishield.app</h1>
        <p className="mt-3 text-zinc-400">
          Repositório único do produto ArbiShield (admin, Supabase na VPS). Em
          produção o nginx serve as rotas abaixo.
        </p>
      </div>
      <nav className="flex flex-col gap-3 text-sm">
        <Link className="rounded-lg border border-zinc-800 px-4 py-3 hover:border-lime-400/40" href="/admin/matches">
          Gestão de Jogos
        </Link>
        <Link className="rounded-lg border border-zinc-800 px-4 py-3 hover:border-lime-400/40" href="/admin/desafios">
          Gestão de Desafios
        </Link>
        <Link className="rounded-lg border border-zinc-800 px-4 py-3 hover:border-lime-400/40" href="/auth">
          Login
        </Link>
        <Link className="rounded-lg border border-zinc-800 px-4 py-3 hover:border-lime-400/40" href="/arbishield">
          Painel operacional (Next)
        </Link>
      </nav>
    </main>
  );
}
