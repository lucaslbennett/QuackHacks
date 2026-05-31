// Frees a TCP port before the dev server boots so `npm run dev` can be run
// repeatedly without ever tripping EADDRINUSE from a stale/leftover process.
// Best-effort: if anything goes wrong (e.g. lsof missing, no perms) it logs and
// exits 0 so it never blocks the server from starting.
import { execFileSync } from "node:child_process";

const port = process.argv[2] || "3000";

function pidsOnPort(p) {
  try {
    const out = execFileSync("lsof", ["-ti", `tcp:${p}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    // lsof exits non-zero when nothing is listening — that's the happy path.
    return [];
  }
}

const pids = pidsOnPort(port);
if (pids.length === 0) {
  console.log(`[freePort] port ${port} already free`);
} else {
  for (const pid of pids) {
    if (pid === String(process.pid)) continue;
    try {
      process.kill(Number(pid), "SIGKILL");
      console.log(`[freePort] killed stale process ${pid} on port ${port}`);
    } catch (err) {
      console.log(`[freePort] could not kill ${pid}: ${err.message}`);
    }
  }
}
