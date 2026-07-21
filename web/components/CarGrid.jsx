'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import CarCard from './CarCard';

const AGENTS = ['All agents', 'Unassigned', 'Luke', 'Darwin', 'Jackson', 'Klaus'];

export default function CarGrid() {
  const [cars, setCars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState('All');
  const [q, setQ] = useState('');
  const [onlyNew, setOnlyNew] = useState(false);
  const [sort, setSort] = useState('newest');
  const [agentFilter, setAgentFilter] = useState('All agents');

  // Initial load
  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from('listings')
        .select('*')
        .order('first_seen', { ascending: false })
        .limit(5000);
      if (active) {
        if (!error && data) setCars(data);
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  // Realtime: new inserts pop in at the top, updates patch in place.
  useEffect(() => {
    const channel = supabase
      .channel('listings-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'listings' }, (payload) => {
        setCars((prev) => [payload.new, ...prev.filter((c) => c.id !== payload.new.id)]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'listings' }, (payload) => {
        setCars((prev) => prev.map((c) => (c.id === payload.new.id ? payload.new : c)));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Optimistically update a car and persist to Supabase.
  async function updateCar(id, fields) {
    setCars((prev) => prev.map((c) => (c.id === id ? { ...c, ...fields } : c)));
    await supabase.from('listings').update(fields).eq('id', id);
  }

  // "Remove" = soft delete so the scraper doesn't re-add it next run.
  async function removeCar(id) {
    setCars((prev) => prev.filter((c) => c.id !== id));
    await supabase.from('listings').update({ dismissed: true }).eq('id', id);
  }

  const filtered = useMemo(() => {
    const list = cars.filter((c) => {
      if (c.dismissed) return false;
      if (city !== 'All' && c.city !== city) return false;
      if (onlyNew && !c.is_new) return false;
      if (agentFilter === 'Unassigned' && c.agent) return false;
      if (agentFilter !== 'All agents' && agentFilter !== 'Unassigned' && c.agent !== agentFilter) return false;
      if (q) {
        const hay = `${c.title || ''} ${c.city || ''} ${c.price_text || ''} ${c.notes || ''}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });

    // Real Facebook listing time (null until we've read it from the car's page).
    const pt = (c) => (c.posted_at ? new Date(c.posted_at).getTime() : null);
    const seen = (c) => new Date(c.first_seen || 0).getTime();
    const price = (c) => (c.price_value == null ? Infinity : c.price_value);

    const sorted = [...list];
    switch (sort) {
      case 'oldest':
        // known times ascending; cars without a known time go last
        sorted.sort((a, b) => {
          if (pt(a) == null && pt(b) == null) return seen(a) - seen(b);
          if (pt(a) == null) return 1;
          if (pt(b) == null) return -1;
          return pt(a) - pt(b);
        });
        break;
      case 'price-low':
        sorted.sort((a, b) => price(a) - price(b));
        break;
      case 'price-high':
        sorted.sort((a, b) => price(b) - price(a));
        break;
      case 'newest':
      default:
        // known times newest-first; cars without a known time go last (pending)
        sorted.sort((a, b) => {
          if (pt(a) == null && pt(b) == null) return seen(b) - seen(a);
          if (pt(a) == null) return 1;
          if (pt(b) == null) return -1;
          return pt(b) - pt(a);
        });
        break;
    }
    return sorted;
  }, [cars, city, q, onlyNew, sort, agentFilter]);

  const newCount = cars.filter((c) => c.is_new && !c.dismissed).length;

  const cityOptions = useMemo(() => {
    const set = new Set(cars.filter((c) => !c.dismissed && c.city).map((c) => c.city));
    return ['All', ...Array.from(set).sort()];
  }, [cars]);

  async function markAllSeen() {
    const ids = cars.filter((c) => c.is_new).map((c) => c.id);
    if (ids.length === 0) return;
    setCars((prev) => prev.map((c) => (c.is_new ? { ...c, is_new: false } : c)));
    await supabase.from('listings').update({ is_new: false, acknowledged: true }).in('id', ids);
  }

  return (
    <>
      <div className="controls">
        <select value={city} onChange={(e) => setCity(e.target.value)} title="Filter by city">
          {cityOptions.map((c) => <option key={c} value={c}>{c === 'All' ? 'All cities' : c}</option>)}
        </select>
        <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} title="Filter by agent">
          {AGENTS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input
          type="text"
          placeholder="Search title / price / notes…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className={`chip ${onlyNew ? 'active' : ''}`}
          onClick={() => setOnlyNew((v) => !v)}
        >
          New only {newCount > 0 ? `(${newCount})` : ''}
        </button>
        <select value={sort} onChange={(e) => setSort(e.target.value)} title="Sort">
          <option value="newest">Newest → Oldest</option>
          <option value="oldest">Oldest → Newest</option>
          <option value="price-low">Price: Low → High</option>
          <option value="price-high">Price: High → Low</option>
        </select>
        <button className="btn secondary" onClick={markAllSeen} disabled={newCount === 0}>
          Mark all seen
        </button>
        <span className="count">{filtered.length} shown</span>
      </div>

      {loading ? (
        <div className="empty">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="empty">No cars yet. Once the scraper runs, matching listings show up here.</div>
      ) : (
        <div className="grid">
          {filtered.map((car) => (
            <CarCard key={car.id} car={car} onUpdate={updateCar} onRemove={removeCar} />
          ))}
        </div>
      )}
    </>
  );
}
