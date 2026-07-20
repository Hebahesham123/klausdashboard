import './globals.css';

export const metadata = {
  title: 'GAD Marketplace Dashboard',
  description: 'New Facebook Marketplace car listings in Bellflower, Montclair & Fontana.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
