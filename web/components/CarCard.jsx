import { useState } from 'react';

const AGENTS = ['Unassigned', 'Luke', 'Darwin', 'Jackson', 'Klaus'];
const STATUSES = ['New', 'Contacted', 'Negotiating', 'Bought', 'Passed'];

function timeAgo(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function CarCard({ car, onUpdate, onRemove }) {
  const price = car.price_text || (car.price_value != null ? `$${car.price_value.toLocaleString()}` : '—');
  const found = timeAgo(car.first_seen);
  const [notes, setNotes] = useState(car.notes || '');
  const status = car.status || 'New';
  const agent = car.agent || 'Unassigned';

  return (
    <div className={`card status-${status.toLowerCase()}`}>
      {car.is_new && <span className="badge-new">NEW</span>}
      {car.is_dealer === true && <span className="badge-dealer">DEALER</span>}
      <button className="remove" title="Remove this car" onClick={() => onRemove(car.id)}>✕</button>

      <a className="imgwrap" href={car.url} target="_blank" rel="noopener noreferrer">
        {car.image_url ? (
          <img src={car.image_url} alt={car.title || 'car'} loading="lazy" />
        ) : (
          <div className="noimg">no photo</div>
        )}
      </a>

      <div className="body">
        <div className="price">{price}</div>
        <a className="title" href={car.url} target="_blank" rel="noopener noreferrer">
          {car.title || 'Car listing'}
        </a>
        <div className="meta">
          {car.city && <span>📍 {car.city}</span>}
        </div>
        {car.mileage && car.mileage !== 'Not listed' && (
          <div className="miles">🚗 {car.mileage}</div>
        )}
        {car.posted_text ? (
          <div className="found">🕒 {car.posted_text}</div>
        ) : (
          <div className="found pending">⏳ reading time…</div>
        )}

        <div className="assign">
          <label>
            Agent
            <select value={agent} onChange={(e) => onUpdate(car.id, { agent: e.target.value === 'Unassigned' ? null : e.target.value })}>
              {AGENTS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label>
            Status
            <select value={status} onChange={(e) => onUpdate(car.id, { status: e.target.value })}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>

        <textarea
          className="notes"
          placeholder="Notes…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => { if (notes !== (car.notes || '')) onUpdate(car.id, { notes }); }}
        />

        <a className="cta" href={car.url} target="_blank" rel="noopener noreferrer">View on Facebook →</a>
      </div>
    </div>
  );
}
