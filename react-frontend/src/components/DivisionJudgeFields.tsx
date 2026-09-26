import type { Division } from "../types";
import { useI18n } from "../i18n";

export type DivisionJudges = Record<Division, string[]>;
export default function DivisionJudgeFields({ value, onChange }: { value: DivisionJudges; onChange: (value: DivisionJudges) => void }) {
  const { language } = useI18n();
  return <>{(["2v2", "under15"] as const).flatMap((division) => [0, 1].map((index) =>
    <label className="field" key={`${division}-${index}`}>
      <span>{division === "2v2" ? "2v2" : "U15"} · {language === "ja" ? "ジャッジ" : "Judge"} {index + 1}</span>
      <input required maxLength={120} value={value[division][index] ?? ""} onChange={(event) => {
        const names = [...value[division]]; names[index] = event.target.value;
        onChange({ ...value, [division]: names });
      }} />
    </label>))}</>;
}
