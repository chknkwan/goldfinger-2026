import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Goldfinger — Math Week 2026",
  description: "ระบบจัดการแข่งขัน Goldfinger โรงเรียนพูลเจริญวิทยาคม",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&family=Nunito:wght@700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen" style={{ fontFamily: "'Sarabun', sans-serif", background: '#fffbeb' }}>
        {children}
      </body>
    </html>
  );
}
