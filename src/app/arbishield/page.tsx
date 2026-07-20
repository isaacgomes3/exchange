import Link from "next/link";
import { ArbiShieldLoginForm } from "@/components/arbishield/LoginForm";

export default function ArbiShieldLoginPage() {
  return (
    <main className="as-shell">
      <div className="as-hero">
        <p className="as-brand">ArbiShield</p>
        <h1 className="as-headline">Painel operacional</h1>
        <p className="as-lede">
          Dashboard geral (usuários, depósitos, tickets). Voltar ao{" "}
          <Link href="/admin">centro admin</Link> ·{" "}
          <Link href="/admin/matches">jogos</Link> ·{" "}
          <Link href="/admin/desafios">desafios</Link>.
        </p>
        <ArbiShieldLoginForm />
      </div>
    </main>
  );
}
