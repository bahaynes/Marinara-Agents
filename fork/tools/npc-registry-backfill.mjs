// Backfill the NPC Registry for an existing chat by running the extractor on each past reply, oldest first.
// Each run goes through the host's retry-agents route with forMessageId, so facts anchor to that reply
// and the extractor sees only the history up to it.
// Runs inside the container (needs the npc-registry agent active on the chat):
//   docker exec -i marinara node - <chatId> [--from N] [--limit N] [--dry] < fork/tools/npc-registry-backfill.mjs
// --from N skips the first N assistant replies (resume); --dry lists what would run.
// Waits while the chat is generating, and stops if a new message arrives mid-backfill.
const [chatId, ...rest] = process.argv.slice(2);
if (!chatId) throw new Error("usage: node - <chatId> [--from N] [--limit N] [--dry]");
const flag = (name, fallback) => {
  const index = rest.indexOf(name);
  return index < 0 ? fallback : Number(rest[index + 1]);
};
const from = flag("--from", 0);
const limit = flag("--limit", Infinity);
const dry = rest.includes("--dry");

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // loopback to the container's own private-CA HTTPS
const BASE = "https://127.0.0.1:7860/api";
const H = { "Content-Type": "application/json", "x-marinara-csrf": "1", "X-Admin-Secret": process.env.ADMIN_SECRET ?? "" };
const get = async (path) => {
  const response = await fetch(`${BASE}${path}`, { headers: H });
  if (!response.ok) throw new Error(`GET ${path}: ${response.status} ${await response.text()}`);
  return response.json();
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const messages = await get(`/chats/${chatId}/messages`);
const replies = messages.filter((message) => message.role === "assistant");
const todo = replies.slice(from, from + limit);
console.log(`${replies.length} replies; running ${todo.length} (from ${from})`);
if (dry) process.exit(0);

let totalApplied = 0;
for (const [offset, message] of todo.entries()) {
  const index = from + offset;
  while ((await get(`/generate/status/${chatId}`)).active) await sleep(5000);
  if ((await get(`/chats/${chatId}/messages`)).length !== messages.length) {
    console.log(`chat changed during backfill; stopped before reply ${index}. Resume with --from ${index}`);
    process.exit(1);
  }
  const started = Date.now();
  const response = await fetch(`${BASE}/generate/retry-agents`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ chatId, agentTypes: ["npc-registry"], forMessageId: message.id, streaming: false }),
  });
  const events = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => {
      try {
        return JSON.parse(line.slice(6));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const result = events.find((event) => event.type === "agent_result")?.data;
  const error = events.find((event) => event.type === "agent_error" || event.type === "error")?.data;
  const diagnostics = result?.data?.diagnostics ?? {};
  totalApplied += diagnostics.applied ?? 0;
  console.log(
    `[${index}] ${message.id} ${response.status} ${((Date.now() - started) / 1000).toFixed(1)}s ` +
      (error ? `ERROR ${JSON.stringify(error).slice(0, 200)}` : JSON.stringify(diagnostics)),
  );
  if (!response.ok || error) {
    console.log(`stopped on error; resume with --from ${index}`);
    process.exit(1);
  }
}
console.log(`done: ${totalApplied} assertions applied`);
