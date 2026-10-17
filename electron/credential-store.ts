import { safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Credentials, CredentialStore } from './core/lg-session';

export function credentialStore(directory: string): CredentialStore {
  const file = path.join(directory, 'lg-credential.bin');
  const assertAvailable = () => {
    if (!safeStorage.isEncryptionAvailable() || process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') throw new Error('Secure credential storage unavailable');
  };
  return {
    read() {
      if (!existsSync(file)) return null;
      assertAvailable();
      const value = JSON.parse(safeStorage.decryptString(readFileSync(file)));
      if (typeof value.token !== 'string' || typeof value.clientId !== 'string' || value.selectedId !== null && typeof value.selectedId !== 'string') throw new Error('Invalid saved credentials');
      return value as Credentials;
    },
    write(value) {
      assertAvailable();
      const encrypted = safeStorage.encryptString(JSON.stringify(value));
      mkdirSync(directory, { recursive: true });
      writeFileSync(`${file}.tmp`, encrypted, { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
    },
    clear() { rmSync(file, { force: true }); rmSync(`${file}.tmp`, { force: true }); },
  };
}
