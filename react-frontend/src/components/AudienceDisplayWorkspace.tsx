import type { Division, EventData } from "../types";
import { divisionConfig } from "../utils";

type Props = { event: EventData; eventId: string; division: Division };

export default function AudienceDisplayWorkspace({ event, eventId, division }: Props) {
  const displayHref = `/display?event=${encodeURIComponent(eventId)}&division=${division}`;
  const settings = divisionConfig(event, division);

  return <section className="display-workspace">
    <header className="workspace-heading compact-heading"><div><h1>Audience display</h1><p>Show the current prelim matchup, on-deck matchup, and {settings.prelims.secondsPerSide}-second timer on the projector or TV.</p></div></header>
    <section className="display-workspace__launch">
      <div><strong>{event.name}</strong><span>{settings.name} prelims · live updates</span></div>
      <a className="ui-button ui-button--primary" href={displayHref} target="_blank" rel="noreferrer">Open audience display</a>
    </section>
    <p className="display-workspace__note">Advance each side from Prelims. This screen follows automatically. After prelims, switch the projector to the final board. Scores and staff records stay private.</p>
  </section>;
}
