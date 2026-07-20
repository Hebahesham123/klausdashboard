import CarGrid from '@/components/CarGrid';

export default function Home() {
  return (
    <main className="wrap">
      <div className="header">
        <div>
          <h1>🚗 Marketplace Car Watch</h1>
          <div className="sub">Bellflower · Montclair · Fontana — new listings appear here live</div>
        </div>
      </div>
      <CarGrid />
    </main>
  );
}
