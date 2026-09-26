import { useState } from "react";
import { useI18n } from "../i18n";
import { MenyuApi } from "../api";
import type { EventData, EventReport, Staff } from "../types";
import { formatEventDateTime, yen } from "../utils";
import { Button, Icon } from "./ui";
import FinanceWorkspace from "./FinanceWorkspace";

type Props = {
  api: MenyuApi;
  eventId: string;
  event: EventData;
  report: EventReport | null;
  staff: Staff;
  notify: (message: string, error?: boolean) => void;
  onRefresh: () => Promise<void>;
};

export default function ReportsWorkspace({ api, eventId, event, report, staff: currentStaff, notify, onRefresh }: Props) {
  const { language, t } = useI18n();
  const [exporting, setExporting] = useState("");
  const [exportError, setExportError] = useState("");
  const downloadExport = async (kind: "combined" | "registrations" | "rankings" | "bracket" | "staff", extension: "csv" | "pdf") => {
    const exportId = `${kind}.${extension}`;
    try {
      setExporting(exportId); setExportError("");
      await api.downloadExport(eventId, kind, extension, language);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting("");
    }
  };
  const cash = report?.cashByCategory;
  const divisionCash = event.configuration.divisions.map((division) => ({
    id: division.id,
    name: division.name,
    cash: report?.cashByDivision[division.id],
  }));
  const audit = report?.auditLog || [];
  const staff = report?.staffAttendance || event.staffAttendance || [];

  if (!report) return <section className="empty-card state-empty reports-workspace"><strong>{t("reports.noData")}</strong><span>{t("reports.noDataHelp")}</span><Button onClick={() => onRefresh()}>{t("common.reload")}</Button></section>;

  return <div className="reports-workspace">
    <header className="workspace-heading compact-heading"><div><h1>{t("reports.title")}</h1><p>{t("reports.description")}</p></div><div className="report-stamp"><span>{event.name}</span><strong>{formatEventDateTime(event.eventTime, event.timeZone, language)}</strong></div></header>

    <FinanceWorkspace api={api} eventId={eventId} event={event} staff={currentStaff} notify={notify} onRefresh={onRefresh} />

    <section className="report-card cash-report">
      <div className="report-card-heading"><h2>{t("reports.cashByType")}</h2><strong>{report ? yen(report.totals.totalCash) : "—"}</strong></div>
      <div className="cash-categories">
        {divisionCash.map(({ id, name, cash: category }) => <article key={id}><span>{name}</span><strong>{category ? yen(category.total) : "—"}</strong><small>{t("reports.entry")}</small></article>)}
        <article><span>{t("reports.spectatorShort")}</span><strong>{cash ? yen(cash.spectator.total) : "—"}</strong><small>{t("reports.spectator")}</small></article>
        <article className="cash-total"><span>{t("reports.drinksShort")}</span><strong>{report ? yen(report.totals.drinkMoney) : "—"}</strong><small>{t("reports.drinks")}</small></article>
      </div>
    </section>

    <section className="report-grid">
      <article className="report-card export-card">
        <div className="export-card__heading"><h2>{t("reports.exports")}</h2><p>{t("reports.exportsHelp")}</p></div>
        <div className="export-groups">
          <section className="export-group export-group--package" aria-label={t("reports.fullPackage")}>
            <div className="export-group__heading"><h3>{t("reports.fullPackage")}</h3><p>{t("reports.fullPackageHelp")}</p></div>
            <div className="export-command-grid export-command-grid--package">
              <Button className="export-primary" variant="primary" busy={exporting === "combined.csv"} busyLabel={t("reports.exporting")} disabled={Boolean(exporting)} onClick={() => void downloadExport("combined", "csv")}><span>CSV</span><strong>{t("reports.combinedCsv")}</strong><Icon name="download" size={15} /></Button>
              <Button className="export-primary pdf" variant="danger" busy={exporting === "combined.pdf"} busyLabel={t("reports.exporting")} disabled={Boolean(exporting)} onClick={() => void downloadExport("combined", "pdf")}><span>PDF</span><strong>{t("reports.combinedPdf")}</strong><Icon name="download" size={15} /></Button>
            </div>
          </section>
          <section className="export-group" aria-label={t("reports.individualFiles")}>
            <h3>{t("reports.individualFiles")}</h3>
            <div className="export-command-grid">
              <Button disabled={Boolean(exporting)} onClick={() => void downloadExport("registrations", "csv")}>{t("reports.registrationCsv")} <Icon name="download" size={14} /></Button>
              <Button disabled={Boolean(exporting)} onClick={() => void downloadExport("rankings", "csv")}>{t("reports.prelimCsv")} <Icon name="download" size={14} /></Button>
              <Button disabled={Boolean(exporting)} onClick={() => void downloadExport("bracket", "csv")}>{t("reports.bracketCsv")} <Icon name="download" size={14} /></Button>
              <Button disabled={Boolean(exporting)} onClick={() => void downloadExport("staff", "csv")}>{t("reports.staffCsv")} <Icon name="download" size={14} /></Button>
            </div>
          </section>
        </div>
        {exportError && <p className="report-error" role="alert">{t("reports.exportFailed")} {exportError}</p>}
      </article>

      <article className="report-card"><div className="report-card-heading"><h2>{t("reports.staffAttendance")}</h2><b>{staff.length}</b></div><div className="staff-report-list">{staff.map((person) => <div key={person.key}><span className="staff-avatar">{person.name.slice(0, 2).toUpperCase()}</span><p><strong>{person.name}</strong><small>{person.role}</small></p><time>{formatEventDateTime(person.lastActiveAt, event.timeZone, language)}</time></div>)}{!staff.length && <p className="muted">{t("overview.noStaff")}</p>}</div></article>
    </section>

    <section className="report-card audit-report"><div className="report-card-heading"><h2>{t("reports.audit")}</h2><b>{audit.length}</b></div><div className="audit-table"><div className="audit-head"><span>{t("reports.time")}</span><span>{t("reports.staff")}</span><span>{t("reports.action")}</span><span>{t("reports.target")}</span></div>{audit.map((entry) => <div className="audit-row" key={entry.id}><time>{formatEventDateTime(entry.at, event.timeZone, language)}</time><p><strong>{entry.staffName || t("activity.system")}</strong><small>{entry.staffRole}</small></p><span>{t(`activity.${entry.action}`)}</span><code>{entry.targetType}{entry.targetId ? ` · ${entry.targetId}` : ""}</code></div>)}{!audit.length && <p className="muted audit-empty">{t("reports.noAudit")}</p>}</div></section>
  </div>;
}
