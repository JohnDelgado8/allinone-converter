// components/Header.tsx
import Link from 'next/link';

const Header = () => {
  return (
    <header className="bg-slate-800/80 backdrop-blur-md shadow-lg sticky top-0 z-50">
      <nav className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center">
            <Link href="/" className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500">
                MediaTools
            </Link> {/* Maybe a more generic name now? */}
          </div>
          <div className="flex space-x-1 sm:space-x-2 md:space-x-4 text-slate-300"> {/* Adjusted spacing */}
            <Link href="/" className="hover:text-slate-100 px-2 sm:px-3 py-2 rounded-md text-sm font-medium">
                Image Convert
            </Link>
             <Link href="/document-converter" className="hover:text-slate-100 px-2 sm:px-3 py-2 rounded-md text-sm font-medium"> {/* NEW LINK */}
                Document Convert
            </Link>
            <Link href="/transcribe" className="hover:text-slate-100 px-2 sm:px-3 py-2 rounded-md text-sm font-medium">
                Video Transcribe
            </Link>
           
            <Link href="/about" className="hover:text-slate-100 px-2 sm:px-3 py-2 rounded-md text-sm font-medium">
                About
            </Link>
          </div>
        </div>
      </nav>
    </header>
  );
};

export default Header;