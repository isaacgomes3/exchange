export default function NotFound() {
  return (
    <main className="page" style={{ padding: "3rem 1.5rem", textAlign: "center" }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem" }}>404</h1>
      <p style={{ color: "var(--muted)" }}>
        Rota fora do escopo VPS. Use{" "}
        <a href="/desafio-sugestoes" style={{ color: "var(--accent)" }}>
          /desafio-sugestoes
        </a>
        .
      </p>
    </main>
  );
}
