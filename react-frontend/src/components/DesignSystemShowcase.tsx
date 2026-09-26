import { useState } from "react";
import { Alert, Badge, Button, Card, Input, Modal, NavItem, Table, Tabs } from "./ui";

type StateKey = "empty" | "loading" | "error" | "success" | "limits";

type ScreenState = {
  id: string;
  title: string;
  goal: string;
  primary: string;
  empty: string;
  loading: string;
  error: string;
  success: string;
  limits: string;
};

const tokens = [
  { name: "Crew yellow", value: "#FFE500", className: "yellow" },
  { name: "Battle blue", value: "#0B3D91", className: "blue" },
  { name: "Ink black", value: "#090909", className: "ink" },
  { name: "Poster tan", value: "#C9A66B", className: "tan" },
  { name: "Battle red", value: "#F21B1B", className: "red" },
  { name: "Chalk white", value: "#FFFDF7", className: "paper" },
];

const screenStates: ScreenState[] = [
  {
    id: "access", title: "Staff access", goal: "Enter the event-control system.", primary: "Submit staff name, role, and shared access code.",
    empty: "Enter stays disabled until staff name, role, and access code are filled.", loading: "Checking…", error: "Show the authentication failure inline: invalid code, unavailable backend, or expired session.", success: "Open the authenticated shell and load events.", limits: "Shared staff access code only. No individual accounts, read-only role, or permission matrix.",
  },
  {
    id: "sync", title: "Connection and synchronization", goal: "Know whether the event is current across staff devices.", primary: "Continue while live; reload or reconnect when offline.",
    empty: "Not synced before the first successful event load.", loading: "Connecting… or Syncing…", error: "Show Offline, failed refresh, revision-conflict refresh, stale mutation, or archived-event errors.", success: "Synced now, updated timestamp, and a temporary confirmation toast.", limits: "A valid staff session is required. Device preferences may not persist when storage is unavailable.",
  },
  {
    id: "hq-new", title: "Event HQ · New event", goal: "Create the first event record.", primary: "Enter an event name and create the event.",
    empty: "No event records. Explain that a new event record is needed.", loading: "Creating…", error: "Show missing name, invalid timezone, backend, or save failure.", success: "Select the new event and confirm creation.", limits: "Staff authentication is required and the creating staff member enters the audit trail.",
  },
  {
    id: "hq-active", title: "Event HQ · Active event", goal: "Understand readiness and enter the correct operational area.", primary: "Open Arrival Desk, Prelim Table, or Tournament Board.",
    empty: "Unset report values use em dashes; cards explain missing staff and backups.", loading: "Use the global event snapshot loading state.", error: "Show failed refresh, settings, backup, or attendance actions in a toast.", success: "Show live teams, battlers, spectators, cash, attendance, and phase.", limits: "All staff can edit and recover data. Archived events remain locked until restored.",
  },
  {
    id: "event-manager", title: "Event manager", goal: "Open, rename, archive, restore, or delete event records.", primary: "Open an active event.",
    empty: "No event records.", loading: "Disable action buttons while the operation runs.", error: "Show mutation or revision-conflict failure in a toast.", success: "Refresh the event list and confirm the action.", limits: "Archive requires confirmation. Permanent deletion requires typing DELETE and removes backups.",
  },
  {
    id: "settings", title: "Event settings", goal: "Correct event metadata.", primary: "Save the event name, location, dates, prelims time, and judges.",
    empty: "Unset dates display as Not set.", loading: "Disable Save changes while saving.", error: "Show invalid event data or failed save.", success: "Close settings and confirm Saved.", limits: "Staff-only; all authenticated roles can edit.",
  },
  {
    id: "recovery", title: "Backup and recovery", goal: "Create a recovery point or safely restore prior event data.", primary: "Create or restore a selected backup.",
    empty: "No restore points.", loading: "Disable backup and restore controls during the request.", error: "Show missing backup, persistence, or restore failure.", success: "Add the backup, or create a safety backup before restoring and refreshing.", limits: "Restore replaces event operations but preserves or merges attendance and audit history.",
  },
  {
    id: "checkin", title: "Arrival Desk", goal: "Find registrations, collect arrivals, correct records, and record spectators.", primary: "Select a registration and check in individual members.",
    empty: "No matching registrations, Select a registration, No notes, or No change.", loading: "Disable only the active check-in, undo, import, walk-in, link, edit, duplicate, or spectator action.", error: "Show missing fields, invalid records, stale versions, already checked in, archived event, or backend failures.", success: "Update member, payment, and arrival states; add imports or walk-ins; confirm with a toast.", limits: "Canceled registrations cannot check in. Bracket entries cannot be canceled. Concurrent edits use stale-version protection.",
  },
  {
    id: "walkin", title: "Walk-in dialog", goal: "Add a same-day 2v2 team or U-15 battler.", primary: "Create same-day registration.",
    empty: "Required name fields are blank.", loading: "Disable Create while saving.", error: "Show required name/member validation or server failure.", success: "Close the dialog, select the new record, and confirm creation.", limits: "The selected division controls which fields are available.",
  },
  {
    id: "csv", title: "CSV intake dialog", goal: "Import early registrations for the selected division.", primary: "Select and import a CSV.",
    empty: "No CSV selected; Import selected remains disabled.", loading: "Disable Import selected while processing.", error: "Show no-file, malformed import, invalid import, or backend failure.", success: "Report imported, review, and duplicate-warning counts.", limits: "Imports belong to the selected event and division.",
  },
  {
    id: "registration-editor", title: "Registration editor", goal: "Correct participant and contact information.", primary: "Save registration.",
    empty: "Optional fields remain blank and notes display No notes.", loading: "Disable Save changes while updating.", error: "Show stale revision, invalid data, or backend failure.", success: "Close the editor and refresh the selected record.", limits: "Edits are protected by stale-version checks and the archived-event lock.",
  },
  {
    id: "prelims", title: "Prelim Control", goal: "Run qualifying prelims, score entrants, rank them, and resolve cutoff ties.", primary: "Save judge scores and calculate rankings.",
    empty: "No eligible entries, create the prelim order, or complete order and scores first.", loading: "Disable only active score, order, ranking, tie-break, or timer controls.", error: "Show invalid 1–10 scores, missing order, incomplete scores, correction reason, stale data, timer conflict, or archived event.", success: "Lock order, save scores, update averages, calculate qualifiers, save tie order, and synchronize the timer.", limits: "Prelims depend on cutoff. Order locks once. Scores and corrections lock after bracket generation.",
  },
  {
    id: "bracket", title: "Tournament Board", goal: "Generate the bracket, run matches, record rounds, and resolve winners or replays.", primary: "Generate the bracket, then control the selected match.",
    empty: "Tournament not created, Select a match, Waiting for prior round, or Open seed.", loading: "Disable only the active bracket, timer, performance, outcome, or undo control.", error: "Show insufficient entries, invalid match, incomplete rounds, decided match, timer conflict, revision conflict, or archived event.", success: "Render seeded rounds, complete performances, advance winners, create a replay, or restore the prior state with Undo.", limits: "At least two checked-in entries are required. Decisions change through Undo, and required performance rounds are enforced.",
  },
  {
    id: "reports", title: "Reports and records", goal: "Review totals, attendance, audit activity, and export event records.", primary: "Download the combined CSV or PDF package.",
    empty: "Unavailable values use em dashes; explain missing staff and audit activity.", loading: "Use the global event snapshot loading state.", error: "Show snapshot failure or browser download failure.", success: "Render current totals and audit records; download the selected language export.", limits: "Staff-only. Exports contain operational and financial data and are not public.",
  },
  {
    id: "context", title: "Context rail", goal: "Surface unresolved issues and recent staff activity.", primary: "Resolve the issue in its related workspace.",
    empty: "No attention items and No activity yet.", loading: "Update with the event snapshot and synchronization cycle.", error: "Reflect stale or unavailable data through the global sync state.", success: "Update counts for partial teams, duplicates, reviews, payments, arrivals, prelims, brackets, and open matches.", limits: "Informational only; it does not independently enforce permissions.",
  },
];

const stateMeta: Record<StateKey, { label: string; tone: "neutral" | "warn" | "danger" | "good" | "live" }> = {
  empty: { label: "Empty", tone: "neutral" }, loading: { label: "Loading", tone: "warn" }, error: { label: "Error", tone: "danger" }, success: { label: "Success", tone: "good" }, limits: { label: "Limits", tone: "live" },
};

function StateMatrix({ filter }: { filter: "all" | StateKey }) {
  const states = (filter === "all" ? Object.keys(stateMeta) : [filter]) as StateKey[];
  return <div className="ds-state-list">{screenStates.map((screen) => <article className="ds-state-screen" id={`state-${screen.id}`} key={screen.id}>
    <header><div><span className="ui-eyebrow">{screen.goal}</span><h3>{screen.title}</h3></div><p><strong>Primary:</strong> {screen.primary}</p></header>
    <div className="ds-state-grid">{states.map((state) => <div className={`ds-state ds-state--${state}`} key={state}><Badge tone={stateMeta[state].tone}>{stateMeta[state].label}</Badge><p>{screen[state]}</p></div>)}</div>
  </article>)}</div>;
}

export default function DesignSystemShowcase() {
  const [activeState, setActiveState] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [demoNav, setDemoNav] = useState("checkin");

  return <div className="ds-shell">
    <aside className="ds-sidebar">
      <div className="ds-brand"><strong>CHIP<br />CHOP</strong><span>CONTROL ROOM</span><small>UI system · v1</small></div>
      <nav aria-label="Design system sections">
        <a href="#foundations">Foundations</a><a href="#components">Components</a><a href="#responsive">Responsive</a><a href="#states">Product states</a>
      </nav>
      <a className="ds-back" href="/">← Return to app</a>
    </aside>

    <main className="ds-main">
      <header className="ds-hero">
        <div className="ds-hero-copy"><span className="ds-tape">STAFF-ONLY SYSTEM</span><p>THE MENYU · CHIP CHOP</p><h1>Flyer energy.<br /><mark>Battle-day clarity.</mark></h1><p className="ds-lede">A reusable interface system for registration, scoring, tournament control, synchronization, recovery, and records.</p></div>
        <div className="ds-pulse-demo" aria-label="Event Pulse example">
          <div className="ds-pixel-stamp" aria-hidden="true"><span>CC</span></div>
          <div><small>Current phase</small><strong>Arrival desk <em>LIVE</em></strong></div>
          <div><small>Present</small><strong className="number">46 <span>/ 52</span></strong></div>
          <div><small>Attention</small><strong className="attention">△ 3</strong></div>
          <div><small>Sync</small><strong className="online">● Synced now</strong></div>
        </div>
      </header>

      <section className="ds-section" id="foundations">
        <header className="ds-section-heading"><span>FOUNDATIONS</span><h2>Identity with operational discipline</h2><p>Yellow calls action, blue carries event context, red requires intervention, and white protects legibility.</p></header>
        <div className="ds-token-grid">{tokens.map((token) => <div className="ds-token" key={token.name}><span className={`ds-swatch ds-swatch--${token.className}`} /><strong>{token.name}</strong><code>{token.value}</code></div>)}</div>
        <div className="ds-foundation-grid">
          <Card className="ds-type-card"><span className="ui-eyebrow">Display · Anton / Impact</span><strong>TOP 16</strong><p>Event names, workspace titles, rankings, and major competitive moments.</p></Card>
          <Card className="ds-type-card"><span className="ui-eyebrow">Interface · DM Sans</span><h3>Fast to scan under pressure</h3><p>Forms, controls, helper text, participant records, and staff-facing instructions.</p></Card>
          <Card tone="dark" className="ds-type-card"><span className="ui-eyebrow">Utility · IBM Plex Mono</span><code>ROUND 02 · 00:45 · SYNCED</code><p>Timers, match IDs, timestamps, state labels, and audit details.</p></Card>
        </div>
      </section>

      <section className="ds-section" id="components">
        <header className="ds-section-heading"><span>COMPONENTS</span><h2>Reusable controls and surfaces</h2><p>Every component uses the same touch targets, focus treatment, semantic color, and pressed-state behavior.</p></header>
        <div className="ds-component-grid">
          <Card className="ds-component-card"><span className="ui-eyebrow">Buttons</span><div className="ds-row"><Button variant="primary">Check in</Button><Button>Reload</Button><Button variant="danger">Cancel entry</Button><Button variant="ghost">View activity</Button></div><div className="ds-row"><Button size="sm">Small</Button><Button disabled>Unavailable</Button><Button size="lg" variant="primary">Start replay</Button></div></Card>
          <Card className="ds-component-card"><span className="ui-eyebrow">Inputs</span><label className="field"><span>Staff name</span><Input placeholder="Name used in the audit log" /></label><label className="field"><span>Access code</span><Input type="password" value="chipchop" readOnly /></label><label className="field"><span>Disabled</span><Input value="Locked after bracket generation" disabled readOnly /></label></Card>
          <Card className="ds-component-card"><span className="ui-eyebrow">Badges</span><div className="ds-row"><Badge>Waiting</Badge><Badge tone="warn">Partial</Badge><Badge tone="good">Checked in</Badge><Badge tone="danger">Needs review</Badge><Badge tone="live">Live</Badge></div></Card>
          <Card className="ds-component-card"><span className="ui-eyebrow">Alerts</span><div className="ds-stack"><Alert title="Synced">All staff devices have the current event.</Alert><Alert tone="warn" title="Payment pending">One team member still needs to pay.</Alert><Alert tone="danger" title="Offline">Reconnect before saving another change.</Alert><Alert tone="good" title="Checked in">Maya arrived at 13:42.</Alert></div></Card>
          <Card className="ds-component-card"><span className="ui-eyebrow">Tabs</span><Tabs ariaLabel="Component state examples" active={activeState} onChange={setActiveState} items={[{ id: "all", label: "All", count: 15 }, { id: "empty", label: "Empty" }, { id: "loading", label: "Loading" }, { id: "error", label: "Error" }, { id: "success", label: "Success" }, { id: "limits", label: "Limits" }]} /></Card>
          <Card className="ds-component-card"><span className="ui-eyebrow">Modal</span><p>Dialogs keep one job, one primary action, and an explicit close path.</p><Button variant="primary" onClick={() => setModalOpen(true)}>Open walk-in example</Button></Card>
          <Card className="ds-component-card"><span className="ui-eyebrow">Navigation</span><nav className="ui-nav ds-nav-demo" aria-label="Workspace example"><NavItem active={demoNav === "overview"} icon="HQ" label="Event HQ" onClick={() => setDemoNav("overview")} /><NavItem active={demoNav === "checkin"} icon="IN" label="Arrival Desk" onClick={() => setDemoNav("checkin")} /><NavItem active={demoNav === "bracket"} icon="BRK" label="Tournament Board" onClick={() => setDemoNav("bracket")} /></nav></Card>
          <Card className="ds-component-card ds-table-card"><span className="ui-eyebrow">Table</span><Table><div className="ui-table__head ds-table-row"><span>Entry</span><span>Status</span><span>Payment</span><span>Updated</span></div><div className="ui-table__row ds-table-row"><strong>Blue Rhythm</strong><Badge tone="warn">Partial</Badge><span>¥3,000 due</span><time>13:42</time></div><div className="ui-table__row ds-table-row"><strong>Ren</strong><Badge tone="good">Checked in</Badge><span>Paid</span><time>13:38</time></div></Table></Card>
        </div>
      </section>

      <section className="ds-section" id="responsive">
        <header className="ds-section-heading"><span>RESPONSIVE SYSTEM</span><h2>One event, three operating positions</h2><p>The information stays consistent while density and navigation adapt to the staff member’s device and physical role.</p></header>
        <div className="ds-device-stack">
          <article className="ds-device ds-device--desktop">
            <header className="ds-device-label"><div><span>Desktop command center</span><strong>1440 × 900</strong></div><p>Full event context, registration ledger, selected record, and attention rail remain visible together.</p></header>
            <div className="ds-desktop-frame" inert>
              <div className="ds-desktop-sidebar"><strong>CHIP<br />CHOP</strong><small>CONTROL ROOM</small><div className="ds-desktop-nav"><span>HQ</span><span className="active">IN</span><span>PRE</span><span>BRK</span><span>RPT</span></div></div>
              <div className="ds-desktop-stage">
                <header><div><small>CURRENT PHASE</small><strong>Arrival desk <em>LIVE</em></strong></div><div><small>NEXT MILESTONE</small><strong>Prelims in 28 min</strong></div><div><small>PRESENT</small><strong>46 / 52</strong></div><div><small>ATTENTION</small><strong>△ 3</strong></div></header>
                <div className="ds-mini-main"><section className="ds-mini-ledger"><label><span>⌕</span><input value="" placeholder="Search registration" readOnly /></label><div className="head"><span>Entry</span><span>Status</span></div><button className="selected"><b>01</b><span><strong>Blue Rhythm</strong><small>@bluerhythm · 2v2</small></span><Badge tone="warn">Partial</Badge></button><button><b>02</b><span><strong>Ren</strong><small>@renmoves · U-15</small></span><Badge tone="good">Present</Badge></button><button><b>03</b><span><strong>Motion Lab</strong><small>@motionlab · 2v2</small></span><Badge>Waiting</Badge></button></section><section className="ds-mini-detail"><div className="ticket"><small>2V2 · #001</small><h3>Blue Rhythm</h3><span>@bluerhythm · ¥3,000 due</span></div><div className="members"><article><Badge tone="good">Checked in</Badge><strong>Maya</strong><Button size="sm">Undo</Button></article><article><Badge tone="warn">Waiting</Badge><strong>Kai</strong><Button size="sm" variant="primary">Check in</Button></article></div></section><div className="ds-mini-rail"><strong>Attention</strong><span><b>1</b> Partial team</span><span><b>1</b> Payment due</span><span><b>1</b> Needs review</span></div></div>
              </div>
            </div>
          </article>

          <div className="ds-device-pair">
            <article className="ds-device ds-device--tablet">
              <header className="ds-device-label"><div><span>Tablet workstation</span><strong>834 × 1194</strong></div><p>Touch-first split view keeps the ledger and selected record together; attention moves below.</p></header>
              <div className="ds-tablet-frame" inert>
                <header><strong>CHIP CHOP</strong><span>Arrival desk</span><Badge tone="good">● Live</Badge></header>
                <section className="ds-tablet-pulse"><div><small>PRESENT</small><strong>46 / 52</strong></div><div><small>NEXT</small><strong>Prelims · 28m</strong></div><div><small>ATTENTION</small><strong>△ 3</strong></div></section>
                <div className="ds-tablet-main"><section className="ds-tablet-list"><label><span>⌕</span><input placeholder="Search" readOnly /></label><button className="selected"><span><b>Blue Rhythm</b><small>@bluerhythm</small></span><Badge tone="warn">Partial</Badge></button><button><span><b>Ren</b><small>@renmoves</small></span><Badge tone="good">Present</Badge></button><button><span><b>Motion Lab</b><small>@motionlab</small></span><Badge>Waiting</Badge></button></section><section className="ds-tablet-detail"><Badge tone="warn">Partial</Badge><h3>Blue Rhythm</h3><p>2v2 · ¥3,000 due</p><div><strong>Kai</strong><span>Waiting at door</span><Button variant="primary" full>Check in Kai</Button></div><div className="checked"><strong>Maya</strong><span>Arrived 13:42</span><Button full>Undo check-in</Button></div></section></div>
                <div className="ds-tablet-nav"><button>HQ</button><button className="active">Arrival</button><button>Prelims</button><button>Bracket</button></div>
              </div>
            </article>

            <article className="ds-device ds-device--mobile">
              <header className="ds-device-label"><div><span>Mobile companion</span><strong>390 × 844</strong></div><p>One-handed search and check-in with one prominent action per record.</p></header>
              <div className="ds-phone" inert>
            <header><span>CHIP CHOP</span><Badge tone="good">● Live</Badge></header>
            <section className="ds-phone-pulse"><small>NEXT MILESTONE</small><strong>Prelims in 28 min</strong><span>46 / 52 present · 3 need attention</span></section>
            <div className="ds-phone-main"><label className="field"><span>Search registration</span><Input placeholder="Name, team, or Instagram" /></label><article><div><Badge tone="warn">Partial</Badge><h3>Blue Rhythm</h3><p>@bluerhythm · 2v2</p></div><Button variant="primary" full>Check in Kai · ¥3,000</Button></article><article className="checked"><div><Badge tone="good">Checked in</Badge><h3>Ren</h3><p>@renmoves · U-15</p></div><Button full>Undo check-in</Button></article></div>
            <div className="ds-phone-nav"><button>⌂<span>Now</span></button><button className="active">⌕<span>Search</span></button><button>＋<span>Add</span></button><button>◉<span>Pulse</span></button></div>
              </div>
            </article>
          </div>
        </div>
        <Card tone="accent" className="ds-responsive-rules"><span className="ui-eyebrow">Shared responsive rules</span><div><p><strong>Desktop:</strong> maximum context and parallel work.</p><p><strong>Tablet:</strong> touch-first split workstation.</p><p><strong>Mobile:</strong> one-handed companion for search, arrival, and pulse.</p></div><ul><li>44px touch targets</li><li>No hover-only actions</li><li>Persistent phase and sync</li><li>Wide tables become split views, then cards</li><li>Reduced motion freezes sprite feedback</li></ul></Card>
      </section>

      <section className="ds-section" id="states">
        <header className="ds-section-heading"><span>PRODUCT STATE MAP</span><h2>Every state the crew must recognize</h2><p>These examples are the acceptance checklist for each workspace—not generic placeholder copy.</p></header>
        <Tabs className="ds-state-filter" ariaLabel="Product state filter" active={activeState} onChange={setActiveState} items={[{ id: "all", label: "All states" }, { id: "empty", label: "Empty" }, { id: "loading", label: "Loading" }, { id: "error", label: "Error" }, { id: "success", label: "Success" }, { id: "limits", label: "Limits" }]} />
        <StateMatrix filter={activeState as "all" | StateKey} />
      </section>
    </main>

    {modalOpen && <Modal eyebrow="DOOR ENTRY" title="Add walk-in" onClose={() => setModalOpen(false)} actions={<><Button onClick={() => setModalOpen(false)}>Cancel</Button><Button variant="primary" onClick={() => setModalOpen(false)}>Create walk-in</Button></>}><div className="ui-mobile-stack"><label className="field"><span>Team name</span><Input placeholder="Required" /></label><label className="field"><span>Member names</span><Input placeholder="Name one, Name two" /></label><label className="field"><span>Instagram · optional</span><Input placeholder="@handle" /></label></div><Alert tone="warn" title="2v2 selected">Both member names are required before creation.</Alert></Modal>}
  </div>;
}
