import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Vision", description: "An AI team that builds your app" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <a href="/" className="logo">Vision</a>
          <nav><a href="/discovery">New project</a></nav>
        </header>
        {children}
      </body>
    </html>
  );
}
