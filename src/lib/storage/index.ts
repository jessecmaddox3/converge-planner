import { getSupabaseServiceClient } from '../supabase-server';
import { runtimeConfig } from '../runtime/config';
import { openLocalStore, type LocalStore } from './local';
import { sqlStorage, supabaseStorage, type Storage } from './port';

const shared = globalThis as typeof globalThis & {convergeLocal?: Promise<LocalStore>};
export function localStore(): Promise<LocalStore> {
  const config = runtimeConfig();
  if (config.mode !== 'demo') throw new Error('Demo storage is unavailable in production.');
  return shared.convergeLocal ??= openLocalStore(config.dataDirectory);
}
const localPort = sqlStorage(async () => (await localStore()).db);

export function getStorage(): Storage | null {
  // Existing focused unit tests inject nullable Supabase fakes to exercise errors.
  // A shipped runtime never selects the test-only in-memory reference branch.
  if (process.env.NODE_ENV === 'test' && !process.env.CONVERGE_MODE) {
    const injected = getSupabaseServiceClient();
    return injected ? supabaseStorage(injected) : null;
  }
  const config = runtimeConfig();
  if (config.mode === 'demo') return localPort;
  const client = getSupabaseServiceClient();
  if (!client) throw new Error('Durable production storage is required.');
  return supabaseStorage(client);
}

export async function closeLocalStore() {
  if (!shared.convergeLocal) return;
  const pending = shared.convergeLocal;
  delete shared.convergeLocal;
  await (await pending).close();
}
