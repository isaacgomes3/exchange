import { ArbiShieldLoginForm } from "@/components/arbishield/LoginForm";

export default function ArbiShieldLoginPage() {
  return (
    <main className="as-shell">
      <div className="as-hero">
        <p className="as-brand">ArbiShield</p>
        <h1 className="as-headline">Acesso ao sistema</h1>
        <p className="as-lede">
          Painel operacional temporário no mesmo backend Supabase, enquanto o
          domínio arbishield.com permanece bloqueado.
        </p>
        <ArbiShieldLoginForm />
      </div>
    </main>
  );
}
