import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import Link from "next/link";
import "./globals-v2.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-arbishield",
});

export const metadata: Metadata = {
  title: "ArbiShield",
  description:
    "Proteção inteligente para operações esportivas — mesmo banco, sistema novo.",
};

export default function V2Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${jakarta.variable} v2-root min-h-screen`}>
      <header className="v2-header">
        <Link href="/v2" className="v2-brand">
          Arbi<span>Shield</span>
        </Link>
        <nav className="v2-nav">
          <Link href="/v2/auth">Entrar</Link>
          <Link href="/v2/app" className="v2-cta">
            App
          </Link>
          <Link href="/v2/admin">Admin</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
