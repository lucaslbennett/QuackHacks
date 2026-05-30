const ts = () => new Date().toISOString();

function fmt(scope, args) {
  return [`[${ts()}]`, scope ? `[${scope}]` : "", ...args].filter(Boolean);
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
