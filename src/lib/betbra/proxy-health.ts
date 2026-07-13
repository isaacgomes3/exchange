import { getBetBraConfig } from "./config";

export async function isLocalProxyAvailable(): Promise<boolean> {
  const config = getBetBraConfig();
  if (!config.useLocalProxy) return true;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${config.localProxyUrl}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

export function getLocalProxyErrorMessage(): string {
  const config = getBetBraConfig();
  return `Proxy local não está rodando em ${config.localProxyUrl}. Execute: npm run proxy:local`;
}
