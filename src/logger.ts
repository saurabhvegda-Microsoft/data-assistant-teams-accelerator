export interface StructuredLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

function emit(level: string, namespace: string, message: string, meta?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    namespace,
    message,
  };

  if (meta) {
    for (const [key, value] of Object.entries(meta)) {
      if (key === "data" || key === "result" || key === "rows" || key === "metrics") continue;
      entry[key] = value;
    }
  }

  process.stdout.write(JSON.stringify(entry) + "\n");
}

export function createLogger(namespace: string): StructuredLogger {
  return {
    info: (message, meta) => emit("info", namespace, message, meta),
    warn: (message, meta) => emit("warn", namespace, message, meta),
    error: (message, meta) => emit("error", namespace, message, meta),
    debug: (message, meta) => emit("debug", namespace, message, meta),
  };
}
