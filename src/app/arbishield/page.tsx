import Link from "next/link";
import { ArbiShieldLoginForm } from "@/components/arbishield/LoginForm";

export default function ArbiShieldLoginPage() {
  return (
    <main className="as-shell">
      <div className="as-hero">
        <p className="as-brand">ArbiShield</p>
        <h1 className="as-headline">Painel operacional</h1>
        <p className="as-lede">
          Dashboard admin (usuários, depósitos, tickets). Para{" "}
          <strong>Gestão de Jogos</strong> e <strong>Desafios</strong>, use{" "}
          <Link href="/admin/matches">/admin/matches</Link> e{" "}
          <Link href="/admin/desafios">/admin/desafios</Link>.
        </p>
        <ArbiShieldLoginForm />
      </div>
    </main>
  );
}
