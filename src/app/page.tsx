import { redirect } from "next/navigation";

/** Raiz só redireciona — app VPS fica em /desafio-sugestoes */
export default function HomePage() {
  redirect("/desafio-sugestoes");
}
