import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mis Suscripciones — Nandología",
  description: "Rastreador de suscripciones recurrentes",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
