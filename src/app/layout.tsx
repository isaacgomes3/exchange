import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Exchange · Desafio",
  description: "Sugestão de Desafio com análise de IA",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
