import type { EventConfiguration, EventDivisionConfiguration } from "../types";
import { Button } from "./ui";

export const legacyConfiguration = (): EventConfiguration => ({
  schemaVersion: 1, competitionFormat: "head_to_head",
  divisions: [
    { id: "2v2", name: "2v2 Battle", ageGroup: "Open", teamSize: 2, registrationLimit: null, prelims: { enabled: true, qualifierCount: 16, entryThreshold: 16, maxQualificationSpots: 16, judgeCount: 2, tieBreakRule: "manual_order", secondsPerSide: 90, scoreMinimum: 1, scoreMaximum: 10 }, bracket: { enabled: true, type: "single_elimination", qualifierCount: 16, size: 16, seedMode: "prelim_rank", regularPerformanceRounds: 1, finalPerformanceRounds: 2, secondsPerBattler: 45, movesPerBattler: 1 }, judges: ["CanDoo", "D.MYST"], financial: { earlyEntryFee: 4000, sameDayEntryFee: 4500, drinkFee: 700 } },
    { id: "under15", name: "Under-15 1v1", ageGroup: "Under 15", teamSize: 1, registrationLimit: null, prelims: { enabled: true, qualifierCount: 8, entryThreshold: 8, maxQualificationSpots: 8, judgeCount: 2, tieBreakRule: "manual_order", secondsPerSide: 90, scoreMinimum: 1, scoreMaximum: 10 }, bracket: { enabled: true, type: "single_elimination", qualifierCount: 8, size: 8, seedMode: "prelim_rank", regularPerformanceRounds: 1, finalPerformanceRounds: 2, secondsPerBattler: 45, movesPerBattler: 1 }, judges: ["Jay-K", "Kano"], financial: { earlyEntryFee: 2000, sameDayEntryFee: 2500, drinkFee: 700 } },
  ],
  staffRoles: ["Event lead", "Check-in", "Prelim judge", "Tournament board", "DJ", "MC", "Records"],
  display: { showEntryNumbers: true, showOnDeck: true, showTimer: true, theme: "chip_chop" },
  financial: { currency: "JPY", spectatorEntryFee: 2000, spectatorDrinkFee: 700 },
});

const blankDivision = (): EventDivisionConfiguration => ({
  id: `division-${Date.now()}`, name: "New division", ageGroup: "Open", teamSize: 1, registrationLimit: null,
  prelims: { enabled: true, qualifierCount: 8, entryThreshold: 8, maxQualificationSpots: 8, judgeCount: 2, tieBreakRule: "manual_order", secondsPerSide: 90, scoreMinimum: 1, scoreMaximum: 10 },
  bracket: { enabled: true, type: "single_elimination", qualifierCount: 8, size: 8, seedMode: "prelim_rank", regularPerformanceRounds: 1, finalPerformanceRounds: 2, secondsPerBattler: 45, movesPerBattler: 1 },
  judges: ["", ""], financial: { earlyEntryFee: 0, sameDayEntryFee: 0, drinkFee: 0 },
});

type Props = { value: EventConfiguration; onChange: (configuration: EventConfiguration) => void; lockedDivisionIds?: string[] };
const number = (value: string, fallback = 0) => Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : fallback;

export default function EventConfigurationFields({ value, onChange, lockedDivisionIds = [] }: Props) {
  const update = (patch: Partial<EventConfiguration>) => onChange({ ...value, ...patch });
  const updateDivision = (index: number, patch: Partial<EventDivisionConfiguration>) => update({ divisions: value.divisions.map((division, current) => current === index ? { ...division, ...patch } : division) });
  const setJudgeCount = (index: number, judgeCount: number) => {
    const division = value.divisions[index];
    const judges = Array.from({ length: judgeCount }, (_, current) => division.judges[current] || `Judge ${current + 1}`);
    updateDivision(index, { judges, prelims: { ...division.prelims, judgeCount } });
  };
  const removeDivision = (index: number) => update({ divisions: value.divisions.filter((_, current) => current !== index) });
  const headToHead = value.competitionFormat === "head_to_head";
  return <fieldset className="event-configuration"><legend>Competition setup</legend>
    <div className="configuration-grid">
      <label className="field"><span>Format</span><select value={value.competitionFormat} onChange={(event) => onChange({ ...value, competitionFormat: event.target.value as EventConfiguration["competitionFormat"], divisions: value.divisions.map((division) => event.target.value === "seven_to_smoke" ? { ...division, prelims: { ...division.prelims, enabled: false }, bracket: { ...division.bracket, enabled: false } } : division) })}><option value="head_to_head">Head-to-head tournament</option><option value="seven_to_smoke">7-to-smoke</option></select></label>
      <label className="field"><span>Staff roles</span><input value={value.staffRoles.join(", ")} onChange={(event) => update({ staffRoles: event.target.value.split(",").map((role) => role.trim()).filter(Boolean) })} /></label>
      <label className="field"><span>Spectator entry fee</span><input type="number" min="0" value={value.financial.spectatorEntryFee} onChange={(event) => update({ financial: { ...value.financial, spectatorEntryFee: number(event.target.value) } })} /></label>
      <label className="field"><span>Spectator drink fee</span><input type="number" min="0" value={value.financial.spectatorDrinkFee} onChange={(event) => update({ financial: { ...value.financial, spectatorDrinkFee: number(event.target.value) } })} /></label>
    </div>
    <div className="configuration-toggles"><label><input type="checkbox" checked={value.display.showEntryNumbers} onChange={(event) => update({ display: { ...value.display, showEntryNumbers: event.target.checked } })} /> Entry numbers on display</label><label><input type="checkbox" checked={value.display.showOnDeck} onChange={(event) => update({ display: { ...value.display, showOnDeck: event.target.checked } })} /> On-deck team on display</label><label><input type="checkbox" checked={value.display.showTimer} onChange={(event) => update({ display: { ...value.display, showTimer: event.target.checked } })} /> Timer on display</label></div>
    <div className="configuration-divisions">
      {value.divisions.map((division, index) => { const locked = lockedDivisionIds.includes(division.id); return <section className="configuration-division" key={`${division.id}-${index}`}>
        <div className="configuration-division__heading"><strong>Division {index + 1}</strong>{value.divisions.length > 1 && <Button size="sm" variant="ghost" disabled={locked} onClick={() => removeDivision(index)}>Remove</Button>}</div>
        <div className="configuration-grid">
          <label className="field"><span>Name</span><input value={division.name} onChange={(event) => updateDivision(index, { name: event.target.value })} /></label>
          <label className="field"><span>Division ID</span><input value={division.id} disabled={locked} onChange={(event) => updateDivision(index, { id: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })} /></label>
          <label className="field"><span>Age group</span><input value={division.ageGroup} onChange={(event) => updateDivision(index, { ageGroup: event.target.value })} /></label>
          <label className="field"><span>Team size</span><input type="number" min="1" max="12" disabled={locked} value={division.teamSize} onChange={(event) => updateDivision(index, { teamSize: Math.min(12, Math.max(1, number(event.target.value, 1))) })} /></label>
          <label className="field"><span>Registration limit</span><input type="number" min="1" placeholder="No limit" value={division.registrationLimit ?? ""} onChange={(event) => updateDivision(index, { registrationLimit: event.target.value === "" ? null : Math.max(1, number(event.target.value, 1)) })} /></label>
          <label className="field"><span>Judges</span><input value={division.judges.join(", ")} onChange={(event) => updateDivision(index, { judges: event.target.value.split(",").map((name) => name.trim()).filter(Boolean) })} placeholder="Names, separated by commas" /></label>
          <label className="field"><span>Early fee</span><input type="number" min="0" value={division.financial.earlyEntryFee} onChange={(event) => updateDivision(index, { financial: { ...division.financial, earlyEntryFee: number(event.target.value) } })} /></label>
          <label className="field"><span>Same-day fee</span><input type="number" min="0" value={division.financial.sameDayEntryFee} onChange={(event) => updateDivision(index, { financial: { ...division.financial, sameDayEntryFee: number(event.target.value) } })} /></label>
          <label className="field"><span>Drink fee</span><input type="number" min="0" value={division.financial.drinkFee} onChange={(event) => updateDivision(index, { financial: { ...division.financial, drinkFee: number(event.target.value) } })} /></label>
        </div>
        {headToHead && <><div className="configuration-toggles"><label><input type="checkbox" checked={division.prelims.enabled} onChange={(event) => updateDivision(index, { prelims: { ...division.prelims, enabled: event.target.checked } })} /> Run prelims</label><label><input type="checkbox" checked={division.bracket.enabled} onChange={(event) => updateDivision(index, { bracket: { ...division.bracket, enabled: event.target.checked } })} /> Use bracket</label></div><div className="configuration-grid"><label className="field"><span>Bracket / qualification size</span><select value={division.bracket.size} onChange={(event) => { const size = Number(event.target.value) as 2 | 4 | 8 | 16 | 32; updateDivision(index, { prelims: { ...division.prelims, qualifierCount: size, maxQualificationSpots: size, entryThreshold: Math.max(division.prelims.entryThreshold, size) }, bracket: { ...division.bracket, qualifierCount: size, size } }); }}><option value={2}>Top 2</option><option value={4}>Top 4</option><option value={8}>Top 8</option><option value={16}>Top 16</option><option value={32}>Top 32</option></select></label><label className="field"><span>Run prelims above</span><input type="number" min="2" value={division.prelims.entryThreshold} onChange={(event) => updateDivision(index, { prelims: { ...division.prelims, entryThreshold: Math.max(2, number(event.target.value, 2)) } })} /></label><label className="field"><span>Judge count</span><input type="number" min="1" max="8" value={division.prelims.judgeCount} onChange={(event) => setJudgeCount(index, Math.min(8, Math.max(1, number(event.target.value, 1))))} /></label><label className="field"><span>Tie break</span><select value={division.prelims.tieBreakRule} onChange={(event) => updateDivision(index, { prelims: { ...division.prelims, tieBreakRule: event.target.value as "manual_order" | "prelim_order" } })}><option value="manual_order">Manual staff order</option><option value="prelim_order">Prelim order</option></select></label><label className="field"><span>Seconds per side</span><input type="number" min="1" value={division.prelims.secondsPerSide} onChange={(event) => updateDivision(index, { prelims: { ...division.prelims, secondsPerSide: Math.max(1, number(event.target.value, 1)) } })} /></label><label className="field"><span>Score range</span><span className="field-inline"><input type="number" min="0" value={division.prelims.scoreMinimum} onChange={(event) => updateDivision(index, { prelims: { ...division.prelims, scoreMinimum: number(event.target.value), scoreMaximum: Math.max(division.prelims.scoreMaximum, number(event.target.value)) } })} /><b>to</b><input type="number" min={division.prelims.scoreMinimum} value={division.prelims.scoreMaximum} onChange={(event) => updateDivision(index, { prelims: { ...division.prelims, scoreMaximum: Math.max(division.prelims.scoreMinimum, number(event.target.value)) } })} /></span></label><label className="field"><span>Bracket seconds</span><input type="number" min="1" value={division.bracket.secondsPerBattler} onChange={(event) => updateDivision(index, { bracket: { ...division.bracket, secondsPerBattler: Math.max(1, number(event.target.value, 1)) } })} /></label></div></>}
      </section>; })}
    </div>
    <Button size="sm" variant="secondary" onClick={() => update({ divisions: [...value.divisions, blankDivision()] })}>Add division</Button>
  </fieldset>;
}
