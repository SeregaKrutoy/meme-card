import type { Metadata } from "next";
import { PracticeGame } from "@/components/PracticeGame";

export const metadata: Metadata = {
  title: "Быстрая игра против ботов — МЕМ-БАТЛ",
  description: "Сыграйте партию в мем-карты сразу: выбирайте карты, судите ответы и набирайте очки.",
};

export default function PracticePage() {
  return <PracticeGame />;
}
