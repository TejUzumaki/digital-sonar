import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Digital Sonar | TejUzumaki",
  description: "Ultrasound and Doppler effect motion detection prototype.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
