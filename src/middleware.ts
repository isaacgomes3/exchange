import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * VPS ArbiShield — só estes caminhos ficam ativos.
 * Qualquer outra rota retorna 404.
 */
const PERMITIDOS = new Set([
  "/desafio-sugestoes",
  "/api/desafio/puxar",
]);

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname.replace(/\/$/, "") || "/";

  if (path === "/" || path === "/desafio-sugestoes.html") {
    return NextResponse.redirect(new URL("/desafio-sugestoes", request.url));
  }

  if (PERMITIDOS.has(path)) {
    return NextResponse.next();
  }

  return new NextResponse("Not Found", { status: 404 });
}

export const config = {
  matcher: [
    /*
     * Ignora assets estáticos do Next.
     * Bloqueia o restante fora da lista permitida.
     */
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)",
  ],
};
