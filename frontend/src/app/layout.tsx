import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "S3 Large File Uploader",
  description: "Chunked multipart upload to AWS S3 — supports files up to 50 GB",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
