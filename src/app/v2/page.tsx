import Link from "next/link";

export default function V2HomePage() {
  return (
    <section className="v2-hero">
      <p className="v2-meta" style={{ marginBottom: 0 }}>
        Sistema novo · mesmo banco Supabase
      </p>
      <h1>
        Arbi<em>Shield</em>
      </h1>
      <p>
        Proteção inteligente para operações esportivas. Visual e dados do{" "}
        arbishield.app — código limpo, sem o SPA legado que congelava o admin.
      </p>
      <div className="v2-actions">
        <Link href="/v2/auth" className="v2-btn v2-btn-primary">
          Entrar
        </Link>
        <Link href="/v2/app" className="v2-btn v2-btn-ghost">
          Área do membro
        </Link>
        <Link href="/v2/admin" className="v2-btn v2-btn-ghost">
          Admin
        </Link>
      </div>
    </section>
  );
}
