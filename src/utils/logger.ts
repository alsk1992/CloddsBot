/**
 * Logger utility using Pino
 */

import pino from 'pino';

const level = process.env.LOG_LEVEL || 'info';

const transport = pino.transport({
  target: 'pino-pretty',
  options: {
    colorize: true,
    translateTime: 'SYS:standard',
    ignore: 'pid,hostname',
  },
});

const rootLogger = pino({ level }, transport);

export function createLogger(name: string) {
  return rootLogger.child({ name });
}

export { rootLogger as logger };
