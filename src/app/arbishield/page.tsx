import Link from "next/link";
import { ArbiShieldLoginForm } from "@/components/arbishield/LoginForm";

export default function ArbiShieldLoginPage() {
  return (
    <main className="as-shell">
      <div className="as-hero">
        <p className="as-brand">ArbiShield</p>
        <h1 className="as-headline">Painel legado (Next)</h1>
        <p className="as-lede">
          A <strong>Gestão de Jogos</strong> que atualizamos (pré-live BetBra,
          mercados, novo evento) fica em{" "}
          <Link href="/admin/matches">/admin/matches</Link> — não nesta rota.
        </p>
        <p className="as-lede">
          Use abaixo só se precisar do dashboard operacional antigo em Next
          (usuários, depósitos, tickets).
        </p>
        <ArbiShieldLoginForm />
      </div>
    </main>
  );
}
