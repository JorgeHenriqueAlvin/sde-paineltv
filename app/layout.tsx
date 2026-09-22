import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TV Corporativa",
  description: "Gerenciamento profissional de conteúdos e programação para TVs corporativas.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
