import { useState, type FormEvent } from 'react';
import { MessageSquarePlus } from 'lucide-react';

const storageKey = 'glacialpoint.integration-suggestion';
function readDraft(): { brand: string; details: string } {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    return { brand: typeof value?.brand === 'string' ? value.brand.slice(0, 80) : '', details: typeof value?.details === 'string' ? value.details.slice(0, 600) : '' };
  } catch { return { brand: '', details: '' }; }
}

export default function IntegrationSuggestion() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(readDraft);
  const [status, setStatus] = useState('');
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft.brand.trim()) { setStatus('Informe uma marca ou aplicativo.'); return; }
    try {
      localStorage.setItem(storageKey, JSON.stringify({ brand: draft.brand.trim(), details: draft.details.trim() }));
      setStatus('Rascunho salvo neste dispositivo. Nenhuma sugestão foi enviada.');
    } catch { setStatus('Não foi possível salvar neste dispositivo. Seu texto continua disponível abaixo.'); }
  }
  return <section className="suggestion-card" aria-label="Sugestões de integrações">
    <div className="suggestion-heading"><MessageSquarePlus size={18}/><div><h4>Sentiu falta de uma integração?</h4><p>Conte qual aparelho você gostaria de adicionar.</p></div></div>
    <button className="suggestion-toggle" aria-expanded={open} aria-controls="suggestion-form" onClick={() => setOpen(!open)}>{open ? 'Fechar sugestão' : 'Sugerir integração'}</button>
    {open && <form id="suggestion-form" className="suggestion-form" onSubmit={save}>
      <label>Marca ou aplicativo<input autoFocus required maxLength={80} value={draft.brand} placeholder="Ex.: marca e nome do app" onChange={e => { setDraft({ ...draft, brand: e.target.value }); setStatus(''); }}/></label>
      <label>Modelo e detalhes <span>(opcional)</span><textarea maxLength={600} rows={3} value={draft.details} placeholder="Qual é o modelo do seu ar-condicionado?" onChange={e => { setDraft({ ...draft, details: e.target.value }); setStatus(''); }}/></label>
      <p>Na prévia, você pode guardar um rascunho local. O envio de sugestões estará disponível quando o canal de pedidos for definido.</p>
      <button className="suggestion-toggle" type="submit">Salvar rascunho</button>
      {status && <p role="status">{status}</p>}
    </form>}
  </section>;
}
