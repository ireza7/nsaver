type Level = "info" | "warn" | "error" | "debug";

const COLORS: Record<Level, string> = {
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
  debug: "\x1b[90m",
};
const RESET = "\x1b[0m";

function format(level: Level, module: string, msg: string): string {
  const ts = new Date().toISOString();
  return `${COLORS[level]}[${ts}] [${level.toUpperCase()}] [${module}]${RESET} ${msg}`;
}

export function createLogger(module: string) {
  return {
    info: (msg: string, ...args: unknown[]) =>
      console.log(format("info", module, msg), ...args),
    warn: (msg: string, ...args: unknown[]) =>
      console.warn(format("warn", module, msg), ...args),
    error: (msg: string, ...args: unknown[]) =>
      console.error(format("error", module, msg), ...args),
    debug: (msg: string, ...args: unknown[]) => {
      if (process.env.NODE_ENV !== "production") {
        console.debug(format("debug", module, msg), ...args);
      }
    },
  };
}
