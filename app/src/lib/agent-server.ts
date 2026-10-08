/** Where the pi-durable agent server listens (the app only proxies to it). */
export const AGENT_SERVER_URL =
  process.env.AGENT_SERVER_URL ?? "http://127.0.0.1:3101";