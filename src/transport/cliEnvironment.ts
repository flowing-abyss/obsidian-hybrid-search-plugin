import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Extra directories added to PATH on spawn so the binary is found regardless
 *  of how Obsidian was launched (autostart, .desktop file, etc.).
 *  On macOS these paths are already present when launched from Terminal;
 *  when launched from Finder they often aren't. */
function augmentedPath(): string {
  const home = os.homedir();

  const extras: string[] = [
    '/usr/local/bin',
    '/usr/bin',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/opt/local/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.yarn', 'bin'),
    path.join(home, '.pnpm'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.asdf', 'shims'),
    path.join(home, '.config', 'npm', 'node_global', 'bin'),
  ];

  // Windows npm global paths
  if (process.platform === 'win32') {
    if (process.env.APPDATA) {
      extras.push(path.join(process.env.APPDATA, 'npm'));
    }
    if (process.env.LOCALAPPDATA) {
      extras.push(path.join(process.env.LOCALAPPDATA, 'npm'));
    }
    // Fallback using homedir if env vars are missing
    extras.push(path.join(home, 'AppData', 'Roaming', 'npm'));
  }

  // nvm
  const nvmBase = path.join(home, '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmBase)) {
    try {
      for (const v of fs.readdirSync(nvmBase)) {
        extras.push(path.join(nvmBase, v, 'bin'));
      }
    } catch {
      /* ignore permission errors */
    }
  }

  // fnm (typical install paths)
  for (const fnmBase of [
    path.join(home, '.local', 'share', 'fnm', 'node-versions'),
    path.join(home, '.fnm', 'node-versions'),
  ]) {
    if (fs.existsSync(fnmBase)) {
      try {
        for (const v of fs.readdirSync(fnmBase)) {
          extras.push(path.join(fnmBase, v, 'installation', 'bin'));
        }
      } catch {
        /* ignore permission errors */
      }
    }
  }

  const existing = process.env.PATH ?? '';
  return existing
    ? `${existing}${path.delimiter}${extras.join(path.delimiter)}`
    : extras.join(path.delimiter);
}

/** Try to turn a bare command name into an absolute path by scanning the
 *  augmented PATH.  If the caller already supplied an absolute/relative path
 *  we leave it untouched so that any ENOENT is reported on the exact path
 *  they configured. */
export function resolveBinary(binaryPath: string): string {
  // Absolute or relative path — trust the user, but on Windows try adding
  // executable extensions if the exact path is missing.
  if (path.isAbsolute(binaryPath) || binaryPath.includes(path.sep)) {
    if (process.platform === 'win32' && !path.extname(binaryPath)) {
      for (const ext of ['.exe', '.cmd', '.bat']) {
        const candidate = binaryPath + ext;
        try {
          if (fs.statSync(candidate).isFile()) {
            return candidate;
          }
        } catch {
          /* keep looking */
        }
      }
    }
    return binaryPath;
  }

  const searchDirs = augmentedPath()
    .split(path.delimiter)
    .map((d) => d.trim())
    .filter(Boolean);

  for (const dir of searchDirs) {
    // On Windows, check .exe/.cmd/.bat BEFORE the bare name.  npm installs both a
    // Unix shell script (no extension) and a .cmd wrapper; statSync reports isFile:true
    // for both, but only .cmd is executable by the Windows process model.
    const candidates: string[] =
      process.platform === 'win32' && !path.extname(binaryPath)
        ? [
            ...['.exe', '.cmd', '.bat'].map((ext) => path.join(dir, binaryPath + ext)),
            path.join(dir, binaryPath),
          ]
        : [path.join(dir, binaryPath)];
    for (const candidate of candidates) {
      try {
        const st = fs.statSync(candidate);
        if (st.isFile()) {
          return candidate;
        }
      } catch {
        // candidate doesn't exist — keep looking
      }
    }
  }

  // Not found anywhere — fall back to the bare name and let spawn() report ENOENT
  return binaryPath;
}

/** Environment for every CLI process the plugin starts.
 *  Obsidian is launched by the OS session, not by a shell, so it never reads the
 *  user's shell config and the API key is missing from `process.env`.  Passing it
 *  explicitly is what lets authenticated embedding providers work at all. */
export function buildCliEnv(vaultPath: string, apiKey: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: augmentedPath(),
    OBSIDIAN_VAULT_PATH: vaultPath,
    ...(apiKey ? { OPENAI_API_KEY: apiKey } : {}),
  };
}
