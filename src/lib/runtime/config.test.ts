import { describe, expect, it } from 'vitest';
import { runtimeConfig } from './config';

describe('explicit local and durable hosted modes', () => {
  it('refuses a generic production next server with no durable configuration', () => {
    expect(() => runtimeConfig({NODE_ENV: 'production'})).toThrow(/CONVERGE_MODE/);
    expect(() => runtimeConfig({NODE_ENV: 'production', CONVERGE_MODE: 'production', CONVERGE_ORIGIN: 'https://trips.example.org'})).toThrow(/SUPABASE_URL/);
  });
  it('never exposes the accountless demo on a public host', () => {
    expect(() => runtimeConfig({CONVERGE_MODE: 'demo', CONVERGE_ORIGIN: 'https://trips.example.org'})).toThrow(/loopback/);
    expect(() => runtimeConfig({CONVERGE_MODE: 'demo', VERCEL: '1'})).toThrow(/loopback/);
    expect(runtimeConfig({CONVERGE_MODE: 'demo'}).origin).toBe('http://127.0.0.1:5075');
  });
  it('rejects origin credentials, paths and mismatched local ports', () => {
    for (const origin of ['http://user:pass@127.0.0.1:5075', 'http://127.0.0.1:5075/path', 'http://127.0.0.1:5076']) expect(() => runtimeConfig({CONVERGE_MODE: 'demo', CONVERGE_ORIGIN: origin})).toThrow();
  });
});
