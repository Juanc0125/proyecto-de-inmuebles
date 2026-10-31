import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, Instrument_Serif } from "next/font/google";
import "./globals.css";
import ServiceWorker from "./components/service-worker";

// Inter for the interface (with its optical-size axis, so headings tighten up
// on their own), Instrument Serif as the editorial accent in display lines
// only, and Geist Mono for numbers, timers and colour codes.
const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  axes: ["opsz"],
});

const display = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const mono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Stickman",
  description: "Genera, revisa, aprueba y publica videos cortos de marketing hipotecario.",
  applicationName: "Stickman",
  appleWebApp: { capable: true, title: "Stickman", statusBarStyle: "black-translucent" },
  icons: {
    // The SVG first: crisp at every size in browsers that take it; the PNGs
    // are for the rest and for installed-app surfaces.
    icon: [
      { url: "/icons/logo-mark.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#04070d",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${sans.variable} ${display.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-ink-950 font-sans text-slate-100">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
