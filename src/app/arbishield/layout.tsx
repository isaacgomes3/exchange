import type { Metadata } from "next";
import { Syne, Manrope } from "next/font/google";
import "./arbishield.css";

const display = Syne({
  subsets: ["latin"],
  variable: "--font-as-display",
});

const body = Manrope({
  subsets: ["latin"],
  variable: "--font-as-body",
});

export const metadata: Metadata = {
  title: "ArbiShield",
  description: "Painel operacional ArbiShield",
};

export default function ArbiShieldLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`as-root ${display.variable} ${body.variable}`}>{children}</div>
  );
}
