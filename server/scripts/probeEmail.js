// Verifies the email-verification pipeline end to end for the CONFIGURED
// provider (EMAIL_PROVIDER). Confirms we can (1) mint/provision a deliverable
// address and (2) authenticate + list that inbox — the two things that have to
// work for Instagram's signup code to be received.
//
// Usage:
//   node server/scripts/probeEmail.js                 # provision a fresh inbox + snapshot it
//   node server/scripts/probeEmail.js <full-address>  # snapshot an existing inbox (run AFTER a
//                                                      # signup to see if IG actually delivered a code)
//   node server/scripts/probeEmail.js <addr> --wait   # poll the address for a code (up to ~60s)
import { config } from "../config.js";
import { generateEmail, waitForEmailCode, inboxSnapshot, identityStatus } from "../services/verification.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("email-probe");

function printConfig() {
  const v = config.verification;
  log.info("Email provider config", {
    emailProvider: v.emailProvider,
    mailtmApiBases: v.mailtmApiBases,
    mailtmPreferredDomain: v.mailtmPreferredDomain || "(auto)",
    mailtmSkipDomains: v.mailtmSkipDomains,
    imap: v.emailProvider === "imap"
      ? {
          host: v.imap.host || "(unset)",
          user: v.imap.user || "(unset)",
          passSet: Boolean(v.imap.pass),
          mailbox: v.imap.mailbox,
          aliasBase: v.imap.aliasBase || "(unset)",
          aliasBasePool: v.imap.aliasBasePool,
          aliasMode: v.imap.aliasMode,
          catchAllDomain: v.imap.catchAllDomain || "(unset)",
          excludeIdentityIds: v.imap.excludeIdentityIds,
        }
      : undefined,
    identityRotation: v.emailProvider === "imap" ? identityStatus() : undefined,
  });
}

function printSnapshot(snap) {
  const msgs = snap.messages || [];
  log.info(`inbox "${snap.address}" holds ${msgs.length} recent message(s)` + (snap.base ? ` (via ${snap.base})` : ""));
  for (const m of msgs.slice(0, 15)) {
    log.info("  •", JSON.stringify({ from: m.from, to: m.to, subject: m.subject, received: m.receivedAt, code: m.code }));
  }
  const withCode = msgs.find((m) => m.code);
  if (withCode) log.info(`✅ A verification code is present in the inbox: ${withCode.code}`);
}

async function main() {
  const args = process.argv.slice(2);
  const wait = args.includes("--wait");
  const target = args.find((a) => !a.startsWith("--"));
  printConfig();

  const provider = config.verification.emailProvider;
  if (!["maildotm", "imap"].includes(provider)) {
    log.warn(`EMAIL_PROVIDER="${provider}" has no automated inbox to probe. Set it to "imap" (recommended) or "maildotm".`);
    if (provider === "mailosaur") log.warn('Note: "mailosaur" policy-blocks Instagram\'s signup emails, so the code never arrives.');
    process.exit(2);
  }

  let address = target;
  if (!address) {
    log.info("No address given — provisioning/minting a fresh one to verify the pipeline…");
    try {
      address = await generateEmail({ seed: "probe" });
      log.info("Address:", address);
    } catch (err) {
      log.error("Failed to mint an address:", err.message);
      process.exit(1);
    }
  } else {
    log.info("Checking existing address:", address);
  }

  try {
    const snap = await inboxSnapshot(address);
    printSnapshot(snap);
    if (!target) {
      log.info("Provisioning + auth + inbox listing all work. ✅");
      log.info("Now send a test email to this address (or run a signup) and re-run:");
      log.info(`  node server/scripts/probeEmail.js ${address}`);
    }
  } catch (err) {
    log.error("Inbox snapshot failed:", err.message);
    process.exit(1);
  }

  if (wait && target) {
    log.info("Polling for a verification code (up to ~60s)…");
    try {
      const hit = await waitForEmailCode({
        influencerId: `probe-${Date.now()}`,
        to: address,
        timeoutMs: 60000,
        receivedAfter: Date.now() - 30 * 60 * 1000,
      });
      log.info(`✅ Got code: ${hit.code} (received ${new Date(hit.receivedAt).toISOString()})`);
    } catch (err) {
      log.warn("No code arrived:", err.message);
    }
  }
}

main().catch((err) => {
  log.error("probe crashed:", err?.stack || err?.message || err);
  process.exit(1);
});
