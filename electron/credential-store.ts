import { safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { elginRegions, type ElginCredentials } from '../shared/elgin';
import type { ElginCredentialStore } from './core/elgin-session';
import type { Credentials, CredentialStore } from './core/lg-session';

// Gravação criptografada (Electron safeStorage) com troca atômica e sem fallback em texto puro.
function secureStore(file: string) {
  const assertAvailable = () => {
    if (!safeStorage.isEncryptionAvailable() || process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') throw new Error('Secure credential storage unavailable');
  };
  return {
    readRaw(): unknown {
      if (!existsSync(file)) return null;
      assertAvailable();
      return JSON.parse(safeStorage.decryptString(readFileSync(file)));
    },
    writeRaw(value: unknown) {
      assertAvailable();
      const encrypted = safeStorage.encryptString(JSON.stringify(value));
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, encrypted, { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
    },
    clear() { rmSync(file, { force: true }); rmSync(`${file}.tmp`, { force: true }); },
  };
}
const isText = (value: unknown) => typeof value === 'string';

export function credentialStore(directory: string): CredentialStore {
  const store = secureStore(path.join(directory, 'lg-credential.bin'));
  return {
    read() {
      const value = store.readRaw() as Credentials | null;
      if (value === null) return null;
      if (!isText(value.token) || !isText(value.clientId) || value.selectedId !== null && !isText(value.selectedId)) throw new Error('Invalid saved credentials');
      return value;
    },
    write(value) { store.writeRaw(value); },
    clear: store.clear,
  };
}

export function elginCredentialStore(directory: string): ElginCredentialStore {
  const store = secureStore(path.join(directory, 'elgin-credential.bin'));
  return {
    read() {
      const value = store.readRaw() as ElginCredentials | null;
      if (value === null) return null;
      if (!isText(value.accessId) || !isText(value.accessSecret) || !(elginRegions as readonly string[]).includes(value.region) || value.selectedId !== null && !isText(value.selectedId)) throw new Error('Invalid saved credentials');
      return value;
    },
    write(value) { store.writeRaw(value); },
    clear: store.clear,
  };
}
