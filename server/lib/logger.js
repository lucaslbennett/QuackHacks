const ts = () => new Date().toISOString();

function fmt(scope, args) {
  const prefix = scope ? `[${ts()}] [${scope}]` : `[${ts()}]`;
  return [prefix, ...args];
}

// Render any thrown value as a useful string. `err.message` is an empty string
// for AggregateError (e.g. pg retrying ECONNREFUSED across IPv6 + IPv4), which
// would otherwise log a blank line after the colon and hide the real cause.
export function formatError(err) {
  if (err == null) return String(err);
  if (typeof err === "string") return err;
  if (err instanceof AggregateError) {
    const inner = (err.errors || [])
      .map((e) => (e && e.message) || String(e))
      .filter(Boolean)
      .join("; ");
    const head = err.message || err.code || err.name || "AggregateError";
    return inner ? `${head}: ${inner}` : head;
  }
  if (err instanceof Error) {
    return err.message || err.code || err.name || String(err);
  }
  return String(err);
}

export function createLogger(scope = "") {
  return {
    info: (...args) => console.log(...fmt(scope, args)),
    warn: (...args) => console.warn(...fmt(scope, args)),
    error: (...args) => console.error(...fmt(scope, args)),
    debug: (...args) => {
      if (process.env.DEBUG) console.log(...fmt(scope, ["[debug]", ...args]));
    },
  };
}

export const log = createLogger();
