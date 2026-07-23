"use client";

import { useEffect } from "react";
import { V2AdminNav } from "@/components/v2/V2AdminNav";

/**
 * Página Next mínima: a gestão de jogos em produção é o HTML estático
 * (lançamento manual + liquidação). Catálogo BetBra foi removido.
 */
export default function V2AdminJogosPage() {
  useEffect(() => {
    window.location.replace("/v2/admin-jogos.html");
  }, []);

  return (
    <div className="v2-page">
      <V2AdminNav />
      <div className="v2-card" style={{ marginTop: 24 }}>
        <p>Abrindo Gestão de Jogos…</p>
        <p>
          <a href="/v2/admin-jogos.html">Clique aqui se não redirecionar</a>
        </p>
      </div>
    </div>
  );
}
