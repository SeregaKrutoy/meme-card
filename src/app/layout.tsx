import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "МЕМ-БАТЛ — карточная игра по мемам для компании",
  description:
    "Ситуация на столе, мем на руках. Создайте комнату, позовите друзей и выкладывайте мемы, которые лучше всего описывают раунд.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body className="bg-void text-violet-50 antialiased">{children}</body>
    </html>
  );
}
