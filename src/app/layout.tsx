// app/layout.tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google'; // Or your preferred font
import './globals.css';
import Header from '@/components/Header'; // Adjust path if your components folder is in src
import Footer from '@/components/Footer'; // Adjust path

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Universal Image Converter',
  description: 'Convert your images to any format, effortlessly.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-gradient-to-br from-slate-900 to-slate-800 text-slate-100 flex flex-col min-h-screen`}>
        <Header />
        {/* Main content area that grows to push footer down */}
        <main className="flex-grow flex flex-col items-center justify-center p-4">
          {children} {/* Page content will be rendered here */}
        </main>
        <Footer />
      </body>
    </html>
  );
}