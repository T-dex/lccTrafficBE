import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Little Cottonwood / Alta drive time",
  description: "UDOT sign–aware estimates to Alta via Little Cottonwood Canyon",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
