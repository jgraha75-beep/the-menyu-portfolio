import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguageProvider } from "../i18n";
import type { Registration } from "../types";
import PrelimBattleRun from "./PrelimBattleRun";

const entries = ["Alpha", "Bravo", "Charlie"].map((teamName, i) => ({ teamName, sourceNumber: String(i + 20), status: "Checked in" }) as Registration);
const render = (index: number) => renderToStaticMarkup(<LanguageProvider><PrelimBattleRun entries={entries} index={index} seconds={90} running={false} disabled={false} onTimer={() => {}} onMove={() => {}} /></LanguageProvider>);
describe("paired prelim performances", () => {
  it("shows a 90-second side, opponent, and next matchup", () => {
    const html = render(0);
    expect(html).toContain("1:30");
    expect(html).toContain("#20 Alpha");
    expect(html).toContain("#21 Bravo");
    expect(html).toContain("#22 Charlie / No opponent");
    expect(html).toContain("Prelim battle 1 / 2");
  });
  it("marks side B current without advancing the battle", () => {
    expect(render(1)).toContain("B · Current");
    expect(render(1)).toContain("Prelim battle 1 / 2");
  });
  it("finishes an odd run without inventing an opponent", () => {
    expect(render(2)).toContain("Finish prelims · enter scores");
    expect(render(3)).toContain("Prelims complete · enter scores");
    expect(render(3)).not.toContain('role="timer"');
  });
});
