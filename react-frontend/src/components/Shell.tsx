import { useEffect, useId, useMemo, useRef, useState } from "react";
import { workspaceAttention } from "../attention";
import { brandAssets } from "../brand";
import { useI18n } from "../i18n";
import type { Division, EventData, EventReport, Registration, Workspace } from "../types";
import { countdownText, formatEventTime } from "../utils";
import ContextRail from "./ContextRail";
import { Button, Icon, NavItem, SegmentedControl } from "./ui";

const workspaceItems: Workspace[] = [
  "now", "checkin", "prelims", "bracket", "display", "records", "settings",
];

type Props = {
  children: React.ReactNode; workspace: Workspace; onWorkspace: (workspace: Workspace) => void; division: Division; onDivision: (division: Division) => void;
  events: EventData[]; eventId: string; onEvent: (eventId: string) => void; onReloadEvents: () => void; event: EventData | null; registrations: Registration[]; report: EventReport | null;
  connected: boolean; syncState: "idle" | "live" | "updating" | "offline" | "review"; staffName: string; roles: string[]; customRole: string; onLogout?: () => Promise<void>;
};

export default function Shell(props: Props) {
  const { language, setLanguage, t } = useI18n(); const [, setClock] = useState(Date.now()); const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const eventSelectId = useId(); const menuButtonRef = useRef<HTMLButtonElement>(null); const dismissButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 15_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!mobileNavOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setMobileNavOpen(false); window.requestAnimationFrame(() => menuButtonRef.current?.focus()); } };
    document.addEventListener("keydown", handleKeyDown, true);
    const focusFrame = window.requestAnimationFrame(() => dismissButtonRef.current?.focus());
    const focusTimer = window.setTimeout(() => dismissButtonRef.current?.focus(), 200);
    return () => { document.removeEventListener("keydown", handleKeyDown, true); window.cancelAnimationFrame(focusFrame); window.clearTimeout(focusTimer); };
  }, [mobileNavOpen]);
  const attention = useMemo(() => props.event ? workspaceAttention(props.workspace, props.division, props.event, props.registrations, props.report?.auditLog || []).reduce((sum, item) => sum + item.count, 0) : 0, [props.workspace, props.division, props.event, props.registrations, props.report?.auditLog]);
  const milestone = props.event?.prelimsStartTime ? countdownText(props.event.prelimsStartTime, language) : "";
  const milestoneLabel = !props.event?.prelimsStartTime ? t("shell.prelimsUnset") : milestone === "started" ? t("shell.prelimsStarted") : t("shell.prelimsIn", { time: milestone });
  const present = props.report?.totals.checkedInBattlers ?? 0; const total = props.report?.totals.totalBattlers ?? 0;
  const syncLabel = props.syncState === "review" ? (language === "ja" ? "変更を確認" : "Review edits") : props.syncState === "live" ? t("shell.syncedNow") : props.syncState === "updating" ? t("shell.syncing") : props.syncState === "offline" ? t("shell.offline") : t("shell.notSynced");
  const closeMobileNav = () => { setMobileNavOpen(false); window.requestAnimationFrame(() => menuButtonRef.current?.focus()); };
  const switchWorkspace = (workspace: Workspace) => { props.onWorkspace(workspace); closeMobileNav(); };
  const divisionItems = props.event?.configuration?.divisions.map((division) => ({ id: division.id, label: division.name })) || [{ id: "2v2", label: "2v2" }, { id: "under15", label: "U-15" }];
  const divisionControl = <SegmentedControl className="division-control" ariaLabel={t("checkin.division")} value={props.division} onChange={(item) => props.onDivision(item as Division)} items={divisionItems} />;
  const languageControl = <SegmentedControl className="language-control" ariaLabel={language === "ja" ? "表示言語" : "Language"} value={language} onChange={(item) => setLanguage(item as "en" | "ja")} items={[{ id: "en", label: "EN" }, { id: "ja", label: "日本語" }]} />;

  return <div className={`menyu-shell${mobileNavOpen ? " nav-open" : ""}`}>
    <a className="skip-link" href="#workspace">{language === "ja" ? "メインコンテンツへ移動" : "Skip to main content"}</a>
    <button className="shell-backdrop" type="button" tabIndex={-1} aria-label={t("common.close")} onClick={closeMobileNav} />
    <aside className="menyu-sidebar" id="shell-navigation">
      <button ref={dismissButtonRef} className="sidebar-dismiss" type="button" aria-label={t("common.close")} onClick={closeMobileNav}><Icon name="close" /></button>
      <div className="menyu-brand" translate="no"><img className="menyu-brand__logo" src={brandAssets.sidebarLockup} alt="CHIP CHOP" width="950" height="860" /><span>THE MENYU</span></div>
      <div className="sidebar-event"><label htmlFor={eventSelectId}>{t("shell.event")}</label><select id={eventSelectId} value={props.eventId} onChange={(event) => props.onEvent(event.target.value)}><option value="">{t("shell.chooseEvent")}</option>{props.events.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><small>{props.event?.location || "Tokyo, Japan"}</small></div>
      <nav className="menyu-nav" aria-label={t("shell.workspaceNavigation")}>{workspaceItems.map((item) => <NavItem active={props.workspace === item} label={t(`nav.${item}`)} key={item} onClick={() => switchWorkspace(item)} />)}</nav>
      <section className="sidebar-mobile-controls">{divisionControl}{languageControl}<Button size="sm" onClick={props.onReloadEvents}><Icon name="refresh" size={15} />{t("common.reload")}</Button></section>
      <section className="sidebar-staff"><span>{t("shell.signedIn")}</span><strong>{props.staffName}</strong><small>{props.roles.length ? props.roles.join(" · ") : props.customRole || "General staff"}</small>{props.onLogout && <Button variant="ghost" size="sm" onClick={props.onLogout}>{t("shell.signOut")} <Icon name="arrowUpRight" size={13} /></Button>}</section>
    </aside>

    <section className="menyu-stage" inert={mobileNavOpen ? true : undefined}>
      <header className="mobile-shell-bar">
        <button ref={menuButtonRef} className="mobile-menu-button" type="button" aria-label={t("shell.openNavigation")} aria-controls="shell-navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}><span /><span /><span /></button>
        <div className="mobile-shell-title"><img src={brandAssets.egg} alt="" width="650" height="900" /><div><strong translate="no">CHIP CHOP</strong><span>{t(`nav.${props.workspace}`)}</span></div></div>
        <div className="mobile-sync-tools">
          <span className={`mobile-sync-state ${props.syncState}`} aria-live="polite">{syncLabel}</span>
          <button className="mobile-reload" type="button" onClick={props.onReloadEvents} aria-label={t("common.reload")}><Icon name="refresh" /></button>
        </div>
      </header>
      <header className="pulse-header" aria-label={t("shell.status")}>
        <div className="pulse-cell"><small>{t("shell.nextMilestone")}</small><strong>{milestoneLabel}</strong></div>
        <div className="pulse-cell"><small>{t("shell.present")}</small><strong className="pulse-number">{present} <span>/ {total}</span></strong></div>
        <div className="pulse-cell alert"><small>{t("shell.workspaceAttention")}</small><strong>{attention}</strong></div>
        <div className="pulse-cell sync"><small>{t("shell.lastSync")}</small><strong className={props.syncState}>{syncLabel}</strong><span>{props.event ? formatEventTime(props.event.updatedAt, props.event.timeZone, language) : "—"}</span></div>
        <div className="pulse-tools">{divisionControl}{languageControl}<button className="sync-button" onClick={props.onReloadEvents} aria-label={t("common.reload")}><Icon name="refresh" /></button></div>
      </header>
      {!props.connected && <section className="connection-banner" role="alert" aria-live="assertive"><div><strong>{t("state.offlineTitle")}</strong><span>{t("state.offlineHelp")}</span></div><Button size="sm" variant="secondary" onClick={props.onReloadEvents}>{t("state.retryNow")}</Button></section>}

      <div className={props.event && props.workspace !== "records" && attention > 0 ? "stage-grid has-context-rail" : "stage-grid full"}>
        <main className="menyu-workspace" id="workspace" tabIndex={-1}>{props.children}</main>
        {props.event && props.workspace !== "records" && attention > 0 && <ContextRail workspace={props.workspace} division={props.division} event={props.event} registrations={props.registrations} report={props.report} />}
      </div>
    </section>
  </div>;
}
