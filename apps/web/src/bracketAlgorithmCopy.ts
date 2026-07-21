import type { BracketConstructionAlgorithm } from "@tab10/shared";

export const BRACKET_ALGORITHM_DIALOG = {
  title: "Как построить сетку?",
  subtitle:
    "Выберите способ распределения участников и автоматических проходов.",
  cancel: "Отмена",
  submit: "Построить сетку",
  regenWarning:
    "Текущая сетка будет построена заново. Результаты предварительного распределения будут сброшены.",
  changeAction: "Изменить способ построения",
  buildAction: "Построить сетку",
  legacyLabel: "Сетка старого формата",
} as const;

export const BRACKET_ALGORITHM_OPTIONS: Record<
  BracketConstructionAlgorithm,
  {
    title: string;
    description: string;
    shortHint: string;
  }
> = {
  compact: {
    title: "Компактная сетка",
    description:
      "Матчи строятся по фактическому числу участников. Если в раунде остаётся нечётное количество игроков, один из них проходит дальше без матча. Сетка получается компактнее и не содержит дополнительных пустых стартовых мест.",
    shortHint: "Подходит для небольших любительских турниров.",
  },
  power_of_two: {
    title: "Классическая сетка",
    description:
      "Сетка расширяется до ближайшего размера 4, 8, 16, 32 и так далее. Свободные места становятся пропусками первого раунда, а лучшие посевы начинают турнир с более поздней стадии.",
    shortHint: "Стандартная фиксированная турнирная сетка.",
  },
};

export const COMPACT_DE_DISABLED_REASON =
  "Для турниров с сеткой проигравших компактный способ пока недоступен.";
// Kept for backwards-compatible imports; compact DE is now supported.

export function algorithmLabel(
  algorithm: BracketConstructionAlgorithm | "legacy" | null | undefined,
): string {
  if (algorithm === "compact") return BRACKET_ALGORITHM_OPTIONS.compact.title;
  if (algorithm === "power_of_two")
    return BRACKET_ALGORITHM_OPTIONS.power_of_two.title;
  if (algorithm === "legacy") return BRACKET_ALGORITHM_DIALOG.legacyLabel;
  return "";
}
