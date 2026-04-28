import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Qwen RAG Chat",
  description: "vLLM chat with FastAPI SSE and FAISS RAG",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
