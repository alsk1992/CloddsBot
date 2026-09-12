import { readFileSync } from 'fs';
import { join } from 'path';

export const RELEASES_URL = 'https://github.com/alsk1992/CloddsBot/releases/latest';
export const RELEASE_INSTALL_COMMAND = `npm install -g ${RELEASES_URL}/download/clodds.tgz`;

export const VERSION = (() => {
  try {
    const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
      version?: string;
    };
    return packageJson.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();
