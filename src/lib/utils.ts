/**
 * Logger utility using tslog for structured logging with file and line information
 */
import { Logger } from "tslog";

// Mapping of log level names to numbers
const levelMap: Record<string, number> = {
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
};

// Convert env LOG_LEVEL string to number, default to info (3)
const minLevel = levelMap[(process.env.LOG_LEVEL || "info").toLowerCase()] ?? 3;

// Create a singleton logger instance
export const logger = new Logger({
  minLevel,
});
