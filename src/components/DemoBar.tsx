'use client';
import {useEffect, useState} from 'react';
import {demoPeople} from '@/lib/demo/people';

export default function DemoBar() {
  const [current, setCurrent] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {void fetch('/api/demo/identity').then(r => r.json()).then(v => setCurrent(v.current)).catch(() => setError('Could not load demo identities.'));}, []);
  async function choose(person: string) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/demo/identity', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({person})});
      if (!response.ok) throw new Error('Could not switch personas.');
      window.location.reload();
    } catch {setError('Could not switch personas. Please retry.'); setBusy(false);}
  }
  return <aside className="demo-bar" aria-label="Local demo controls"><div><strong>Your own little planning sandbox.</strong><p>Every person and calendar here is invented. Confirmations go to a local preview outbox. Nothing is emailed.</p></div><label>Try it as <select value={current} disabled={busy} onChange={e => void choose(e.target.value)}><option value="">Anonymous visitor</option>{demoPeople.map(p => <option key={p.id} value={p.id}>{p.name}, {p.role}</option>)}</select></label><a href="/demo">Example trips and outbox</a>{error && <p role="alert">{error}</p>}</aside>;
}
