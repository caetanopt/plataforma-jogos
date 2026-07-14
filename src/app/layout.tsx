import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Plataforma de Jogos | Caetano",
  description:
    "Criação e gestão de jogos interativos para angariação de leads.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt" className={`${montserrat.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-neutral-50 text-caetano-anthracite">
        {children}
      </body>
    </html>
  );
}
