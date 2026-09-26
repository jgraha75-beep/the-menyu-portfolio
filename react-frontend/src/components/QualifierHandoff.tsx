import { useState } from "react";
import type { MenyuApi } from "../api";
import type { Division } from "../types";
import { useI18n } from "../i18n";
import { Button, Card } from "./ui";

export default function QualifierHandoff({ api, eventId, division, revision, qualifierCount, divisionName, disabled }: { api: MenyuApi; eventId: string; division: Division; revision: number; qualifierCount?: number; divisionName?: string; disabled: boolean }) {
  const { language } = useI18n(); const ja = language === "ja";
  const [result, setResult] = useState<Awaited<ReturnType<MenyuApi["qualifierHandoff"]>> | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const current = result?.division === division && result.revision === revision;
  const text = current ? result.entries.map((entry) => `${entry.seed}. #${entry.number} ${entry.name}`).join("\n") : "";
  const load = async () => { setBusy(true); setError(""); setResult(null); try { setResult(await api.qualifierHandoff(eventId, division)); } catch (error) { setError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
  return <Card className="qualifier-handoff">
    <h2>{ja ? "トーナメントへの引き継ぎ" : "Tournament handoff"} · {divisionName || division} · Top {qualifierCount ?? (division === "2v2" ? 16 : 8)}</h2>
    <p>{ja ? "通過者を確認し、Quanのボードに転記してください。スライドは自動更新されません。" : "Check the qualifiers, then transfer them to Quan’s board. Slides are not updated automatically."}</p>
    <Button disabled={disabled || busy} busy={busy} onClick={load}>{ja ? "通過者を確認" : "Prepare qualifier list"}</Button>
    {error && <p role="alert">{error}</p>}
    {result && !current && <p role="status">{ja ? "データが更新されました。リストを再確認してください。" : "Event data changed. Prepare the list again before using it."}</p>}
    {current && <label className="field"><span>{ja ? "シード順・エントリー番号・名前" : "Seed · entry number · name"}</span><textarea readOnly rows={Math.min(result.entries.length + 1, 17)} value={text} onFocus={(event) => event.target.select()} /></label>}
    <a href="https://docs.google.com/presentation/d/1wyCCayr1nno8Vkzs2xfWrjbn3CWJbVkD/edit#slide=id.p1" target="_blank" rel="noopener noreferrer">{ja ? "Quanのボードを開く（新しいタブ）" : "Open Quan’s board (new tab)"}</a>
  </Card>;
}
