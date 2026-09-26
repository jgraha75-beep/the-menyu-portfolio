import type { Registration } from "../types";
import { useI18n } from "../i18n";
import { registrationTitle } from "../utils";
import { Button, Card } from "./ui";

type Props = {
  entries: (Registration | undefined)[];
  index: number;
  seconds: number;
  running: boolean;
  disabled: boolean;
  onTimer: (action: "start" | "pause" | "reset") => void;
  onMove: (action: "next" | "previous") => void;
};

export default function PrelimBattleRun({ entries, index, seconds, running, disabled, onTimer, onMove }: Props) {
  const { language, t } = useI18n();
  const ja = language === "ja";
  const finished = index >= entries.length;
  const battle = Math.floor(index / 2);
  const title = (entry: Registration | undefined) => entry ? `#${entry.sourceNumber || entry.prelimOrder} ${registrationTitle(entry)}` : (ja ? "対戦相手なし" : "No opponent");
  const matchTitle = (start: number) => `${title(entries[start])} / ${title(entries[start + 1])}`;
  return <Card className="prelim-battle-run">
    <header><h2>{finished ? (ja ? "予選終了・採点入力" : "Prelims complete · enter scores") : `${ja ? "予選バトル" : "Prelim battle"} ${battle + 1} / ${Math.ceil(entries.length / 2)}`}</h2>
      <p>{ja ? "各チーム90秒。全バトル終了後に採点を入力します。" : "90 seconds per side. Enter the judges’ scores after all battles."}</p></header>
    {!finished && <>
      <div className="prelim-battle-sides">{[0, 1].map((side) => {
        const entry = entries[battle * 2 + side];
        const active = index % 2 === side;
        return <section key={side} className={active ? "is-current" : ""} aria-current={active ? "step" : undefined}>
          <span>{side === 0 ? "A" : "B"} · {active ? t("prelims.current") : "90s"}</span>
          <h3>{title(entry)}</h3><p>{entry?.memberNames}</p><small>{entry?.genre}</small>
          {entry && entry.status !== "Checked in" && <p role="alert">{ja ? "受付状態を確認してください" : "Not checked in — confirm before continuing"}</p>}
        </section>;
      })}</div>
      <div className="prelim-battle-clock"><strong role="timer" aria-label={t("prelims.timer")}>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</strong>
        <Button onClick={() => onTimer("start")} disabled={disabled || running}>{t("prelims.start")}</Button>
        <Button onClick={() => onTimer("pause")} disabled={disabled || !running}>{t("prelims.pause")}</Button>
        <Button onClick={() => onTimer("reset")} disabled={disabled}>{ja ? "90秒に戻す" : "Reset 90s"}</Button>
      </div>
      <p><strong>{t("prelims.onDeck")}: </strong>{(battle + 1) * 2 < entries.length ? matchTitle((battle + 1) * 2) : t("prelims.endOrder")}</p>
    </>}
    <footer className="prelim-battle-actions">
      <Button onClick={() => onMove("previous")} disabled={disabled || index === 0}>{ja ? "前の出番に戻す" : "Previous side"}</Button>
      {!finished && <Button variant="primary" onClick={() => onMove("next")} disabled={disabled || running}>{index === entries.length - 1 ? (ja ? "予選終了・採点へ" : "Finish prelims · enter scores") : (ja ? "この出番を終了・次へ" : "Finish side · next")}</Button>}
    </footer>
    <details><summary>{ja ? "全対戦カード" : "All prelim matchups"}</summary><ol className="prelim-matchups">{Array.from({ length: Math.ceil(entries.length / 2) }, (_, match) => <li key={match} aria-current={!finished && match === battle ? "step" : undefined}>{matchTitle(match * 2)}</li>)}</ol></details>
  </Card>;
}
