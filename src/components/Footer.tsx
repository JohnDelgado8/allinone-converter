// components/Footer.tsx
const Footer = () => {
  return (
    <footer className="text-center py-8 text-slate-500 text-sm flex-shrink-0">
      <p>Powered by Next.js, Sharp & Tailwind CSS.</p>
      <p>© {new Date().getFullYear()} John Rodolfo Delgado/Purple Lotus. All rights reserved.</p>
    </footer>
  );
};

export default Footer;