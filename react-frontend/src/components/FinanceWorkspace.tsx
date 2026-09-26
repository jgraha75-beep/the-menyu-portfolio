import { useEffect, useMemo, useState } from "react";
import type { MenyuApi } from "../api";
import { useI18n } from "../i18n";
import type { EventData, FinanceImportPreview, FinancialCategory, FinancialReport, Staff } from "../types";
import { formatEventDateTime, yen } from "../utils";
import { Alert, Button, Input, Select, Textarea } from "./ui";

type Props = {
  api: MenyuApi;
  eventId: string;
  event: EventData;
  staff: Staff;
  notify: (message: string, error?: boolean) => void;
  onRefresh: () => Promise<void>;
};

const categories: Array<{ id: FinancialCategory; label: string; ja: string }> = [
  { id: "registration_income", label: "Registration income", ja: "参加費収入" },
  { id: "spectator_income", label: "Spectator income", ja: "観戦収入" },
  { id: "merchandise_income", label: "Merchandise income", ja: "物販売上" },
  { id: "drink_income", label: "Drink income", ja: "ドリンク売上" },
  { id: "venue_expense", label: "Venue expense", ja: "会場費" },
  { id: "staff_payout", label: "Staff payout", ja: "スタッフ支払" },
  { id: "other_cost", label: "Other event cost", ja: "その他経費" },
  { id: "refund", label: "Refund", ja: "返金" },
  { id: "adjustment", label: "Adjustment", ja: "調整" },
];

const copy = {
  en: {
    eyebrow: "Event finances", title: "Revenue and costs", description: "Reconcile planned and actual money, review the final result, then close the event record.",
    expected: "Expected", actual: "Actual", variance: "Variance", gross: "Gross revenue", expenses: "Event costs", payouts: "Staff payouts", refunds: "Refunds", net: "Net profit", ledger: "Financial ledger", date: "Date", category: "Category", descriptionLabel: "Description", party: "Payee / payer", source: "Source", noTransactions: "No financial activity has been recorded.",
    add: "Add revenue or cost", save: "Save entry", import: "Import costs", choose: "Choose CSV", preview: "Preview import", confirm: "Import reviewed rows", row: "row", review: "Final financial review", notes: "Review notes", markReviewed: "Mark review complete", close: "Close event", reopen: "Reopen event", reopenReason: "Reason for reopening", correction: "Closed-record correction", transaction: "Transaction", corrected: "Corrected actual amount", correctionReason: "Correction reason", saveCorrection: "Record correction", readOnly: "Finance entry is limited to Event leads and Finance leads. This report is read-only for your role.", reviewed: "Reviewed", closed: "Closed", open: "Open", reviewState: "Ready to close", loadFailed: "Financial records could not be loaded.", system: "System record", managed: "Recorded entry", exportCsv: "Finance CSV", exportPdf: "Finance PDF",
  },
  ja: {
    eyebrow: "イベント収支", title: "売上と経費", description: "予定と実績を照合し、最終確認後にイベント記録を締めます。",
    expected: "予定", actual: "実績", variance: "差額", gross: "総収入", expenses: "イベント経費", payouts: "スタッフ支払", refunds: "返金", net: "純利益", ledger: "収支台帳", date: "日付", category: "分類", descriptionLabel: "内容", party: "支払先・入金元", source: "記録元", noTransactions: "収支記録はまだありません。",
    add: "売上・経費を追加", save: "記録を保存", import: "経費CSVを取込", choose: "CSVを選択", preview: "取込内容を確認", confirm: "確認済み行を取込", row: "行", review: "最終収支確認", notes: "確認メモ", markReviewed: "確認完了", close: "イベントを締める", reopen: "イベントを再開", reopenReason: "再開理由", correction: "締め後の修正", transaction: "取引", corrected: "修正後の実績額", correctionReason: "修正理由", saveCorrection: "修正を記録", readOnly: "収支入力はイベント責任者と会計担当者のみ可能です。この役割では閲覧のみできます。", reviewed: "確認済み", closed: "締め済み", open: "入力中", reviewState: "締め準備完了", loadFailed: "収支記録を読み込めませんでした。", system: "運営記録", managed: "手動記録", exportCsv: "収支CSV", exportPdf: "収支PDF",
  },
};

const roleIncludes = (staff: Staff, role: string) => staff.role.split(",").some((candidate) => candidate.trim().toLowerCase() === role.toLowerCase());
const dateInput = () => new Date().toISOString().slice(0, 10);

export default function FinanceWorkspace({ api, eventId, event, staff, notify, onRefresh }: Props) {
  const { language } = useI18n();
  const text = copy[language];
  const canManage = roleIncludes(staff, "Event lead") || roleIncludes(staff, "Finance lead");
  const canReopen = roleIncludes(staff, "Event lead");
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [entry, setEntry] = useState({ category: "merchandise_income" as FinancialCategory, description: "", expectedAmount: "", actualAmount: "", party: "", occurredAt: dateInput() });
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<FinanceImportPreview | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [correction, setCorrection] = useState({ transactionId: "", correctedActualAmount: "", reason: "" });

  const load = async () => {
    try { setError(""); setReport(await api.finance(eventId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  useEffect(() => { void load(); }, [eventId]);

  const run = async (key: string, action: () => Promise<FinancialReport>, success: string, refreshEvent = false) => {
    try {
      setBusy(key); setError(""); const next = await action(); setReport(next); notify(success); if (refreshEvent) await onRefresh();
    } catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); setError(message); notify(message, true); }
    finally { setBusy(""); }
  };

  const categoryName = (category: FinancialCategory) => categories.find((candidate) => candidate.id === category)?.[language === "ja" ? "ja" : "label"] || category;
  const manualTransactions = useMemo(() => report?.transactions.filter((transaction) => transaction.source !== "registration" && transaction.source !== "spectators") || [], [report]);

  if (!report && !error) return <section className="finance-sheet finance-sheet--loading" aria-busy="true"><p>{language === "ja" ? "収支を読み込んでいます…" : "Loading event finances…"}</p></section>;
  if (!report) return <section className="finance-sheet"><Alert tone="danger" title={text.loadFailed}>{error}</Alert><Button onClick={() => void load()}>{language === "ja" ? "再試行" : "Try again"}</Button></section>;

  const statusLabel = report.status === "closed" ? text.closed : report.status === "review" ? text.reviewState : text.open;
  return <section className="finance-sheet">
    <header className="finance-heading">
      <div><span>{text.eyebrow}</span><h2>{text.title}</h2><p>{text.description}</p></div>
      <strong className={`finance-status finance-status--${report.status}`}>{statusLabel}</strong>
    </header>

    <div className="finance-totals" aria-label={`${text.expected} / ${text.actual}`}>
      {[
        [text.gross, report.expected.grossRevenue, report.actual.grossRevenue],
        [text.expenses, report.expected.expenses, report.actual.expenses],
        [text.payouts, report.expected.payouts, report.actual.payouts],
        [text.refunds, report.expected.refunds, report.actual.refunds],
        [text.net, report.expected.netProfit, report.actual.netProfit],
      ].map(([label, expected, actual]) => <div key={String(label)} className={label === text.net ? "finance-total--net" : ""}><span>{label}</span><strong>{yen(Number(actual))}</strong><small>{text.expected} {yen(Number(expected))}</small></div>)}
    </div>

    {!canManage && <Alert tone="info">{text.readOnly}</Alert>}
    {error && <Alert tone="danger">{error}</Alert>}

    <section className="finance-ledger">
      <div className="finance-section-heading"><h3>{text.ledger}</h3><div><Button size="sm" onClick={() => void api.downloadExport(eventId, "finance", "csv", language)}>{text.exportCsv}</Button><Button size="sm" onClick={() => void api.downloadExport(eventId, "finance", "pdf", language)}>{text.exportPdf}</Button></div></div>
      <div className="finance-table" role="table" aria-label={text.ledger}>
        <div className="finance-table__head" role="row"><span>{text.date}</span><span>{text.descriptionLabel}</span><span>{text.expected}</span><span>{text.actual}</span><span>{text.source}</span></div>
        {report.transactions.map((transaction) => <div className={`finance-table__row ${transaction.source === "correction" ? "finance-table__row--correction" : ""}`} role="row" key={transaction.id}>
          <time>{formatEventDateTime(transaction.occurredAt, event.timeZone, language)}</time>
          <div><strong>{transaction.description}</strong><small>{categoryName(transaction.category)}{transaction.party ? ` · ${transaction.party}` : ""}{transaction.correctionReason ? ` · ${transaction.correctionReason}` : ""}</small></div>
          <b>{yen(transaction.expectedAmount)}</b><b>{yen(transaction.actualAmount)}</b>
          <span>{transaction.source === "registration" || transaction.source === "spectators" ? text.system : text.managed}</span>
        </div>)}
        {!report.transactions.length && <p className="finance-empty">{text.noTransactions}</p>}
      </div>
    </section>

    {canManage && report.status !== "closed" && <div className="finance-controls">
      <details open className="finance-control"><summary>{text.add}</summary><form onSubmit={(event_) => { event_.preventDefault(); void run("entry", async () => {
        const result = await api.addFinancialTransaction(eventId, { category: entry.category, description: entry.description, expectedAmount: Number(entry.expectedAmount || 0), actualAmount: Number(entry.actualAmount || 0), party: entry.party, occurredAt: entry.occurredAt }, staff);
        setEntry({ category: "merchandise_income", description: "", expectedAmount: "", actualAmount: "", party: "", occurredAt: dateInput() }); return result.report;
      }, language === "ja" ? "収支を記録しました。" : "Financial entry recorded."); }}>
        <label><span>{text.category}</span><Select value={entry.category} onChange={(event_) => setEntry((current) => ({ ...current, category: event_.target.value as FinancialCategory }))}>{categories.map((category) => <option key={category.id} value={category.id}>{language === "ja" ? category.ja : category.label}</option>)}</Select></label>
        <label className="finance-field--wide"><span>{text.descriptionLabel}</span><Input required maxLength={180} value={entry.description} onChange={(event_) => setEntry((current) => ({ ...current, description: event_.target.value }))} /></label>
        <label><span>{text.expected}</span><Input inputMode="numeric" type="number" value={entry.expectedAmount} onChange={(event_) => setEntry((current) => ({ ...current, expectedAmount: event_.target.value }))} /></label>
        <label><span>{text.actual}</span><Input inputMode="numeric" type="number" value={entry.actualAmount} onChange={(event_) => setEntry((current) => ({ ...current, actualAmount: event_.target.value }))} /></label>
        <label><span>{text.party}</span><Input maxLength={120} value={entry.party} onChange={(event_) => setEntry((current) => ({ ...current, party: event_.target.value }))} /></label>
        <label><span>{text.date}</span><Input type="date" value={entry.occurredAt} onChange={(event_) => setEntry((current) => ({ ...current, occurredAt: event_.target.value }))} /></label>
        <Button variant="primary" busy={busy === "entry"} type="submit">{text.save}</Button>
      </form></details>

      <details className="finance-control"><summary>{text.import}</summary><div className="finance-import">
        <label className="finance-file"><span>{text.choose}</span><Input type="file" accept=".csv,text/csv" onChange={async (event_) => { const file = event_.target.files?.[0]; setCsv(file ? await file.text() : ""); setPreview(null); }} /></label>
        <Button disabled={!csv} busy={busy === "preview"} onClick={async () => { try { setBusy("preview"); setError(""); setPreview(await api.previewFinancialImport(eventId, csv, staff)); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(""); } }}>{text.preview}</Button>
        {preview && <div className="finance-import-preview">
          {preview.errors.map((issue, index) => <Alert key={`error-${index}`} tone="danger">{issue.row ? `${text.row} ${issue.row}: ` : ""}{issue.message}</Alert>)}
          {preview.warnings.map((issue, index) => <Alert key={`warning-${index}`} tone="warn">{issue.row ? `${text.row} ${issue.row}: ` : ""}{issue.message}</Alert>)}
          {preview.records.length > 0 && <div className="finance-preview-rows">{preview.records.map((record) => <div key={record.id}><span>{categoryName(record.category)}</span><strong>{record.description}</strong><b>{yen(record.actualAmount)}</b></div>)}</div>}
          <Button variant="primary" disabled={!preview.canImport} busy={busy === "import"} onClick={() => void run("import", async () => { const result = await api.importFinancialRecords(eventId, csv, staff); setCsv(""); setPreview(null); return result.report; }, language === "ja" ? "経費を取り込みました。" : "Financial records imported.")}>{text.confirm}</Button>
        </div>}
      </div></details>

      <details open={report.status === "review"} className="finance-control finance-control--final"><summary>{text.review}</summary><div className="finance-final-review">
        <label><span>{text.notes}</span><Textarea rows={3} maxLength={1200} value={reviewNotes} onChange={(event_) => setReviewNotes(event_.target.value)} /></label>
        <div><Button busy={busy === "review"} onClick={() => void run("review", () => api.reviewFinances(eventId, reviewNotes, staff), language === "ja" ? "最終確認を記録しました。" : "Final financial review recorded.")}>{text.markReviewed}</Button><Button variant="danger" disabled={report.status !== "review"} busy={busy === "close"} onClick={() => void run("close", () => api.closeEventFinances(eventId, staff), language === "ja" ? "イベントを締めました。" : "Event finances closed.", true)}>{text.close}</Button></div>
      </div></details>
    </div>}

    {canManage && report.status === "closed" && <div className="finance-closed-actions">
      <section className="finance-control"><h3>{text.correction}</h3><div className="finance-correction-form">
        <label><span>{text.transaction}</span><Select value={correction.transactionId} onChange={(event_) => setCorrection((current) => ({ ...current, transactionId: event_.target.value }))}><option value="">—</option>{report.transactions.filter((transaction) => transaction.source !== "correction").map((transaction) => <option value={transaction.id} key={transaction.id}>{transaction.description} · {yen(transaction.actualAmount)}</option>)}</Select></label>
        <label><span>{text.corrected}</span><Input type="number" inputMode="numeric" value={correction.correctedActualAmount} onChange={(event_) => setCorrection((current) => ({ ...current, correctedActualAmount: event_.target.value }))} /></label>
        <label className="finance-field--wide"><span>{text.correctionReason}</span><Input minLength={3} maxLength={240} value={correction.reason} onChange={(event_) => setCorrection((current) => ({ ...current, reason: event_.target.value }))} /></label>
        <Button disabled={!correction.transactionId || correction.correctedActualAmount === "" || correction.reason.trim().length < 3} busy={busy === "correction"} onClick={() => void run("correction", async () => { const result = await api.correctFinancialTransaction(eventId, correction.transactionId, Number(correction.correctedActualAmount), correction.reason, staff); setCorrection({ transactionId: "", correctedActualAmount: "", reason: "" }); return result.report; }, language === "ja" ? "修正を記録しました。" : "Correction recorded.")}>{text.saveCorrection}</Button>
      </div></section>
      {canReopen && <section className="finance-control"><h3>{text.reopen}</h3><div className="finance-reopen-form"><label><span>{text.reopenReason}</span><Input minLength={3} maxLength={240} value={reopenReason} onChange={(event_) => setReopenReason(event_.target.value)} /></label><Button variant="danger" disabled={reopenReason.trim().length < 3} busy={busy === "reopen"} onClick={() => void run("reopen", () => api.reopenEventFinances(eventId, reopenReason, staff), language === "ja" ? "イベントを再開しました。" : "Event finances reopened.", true)}>{text.reopen}</Button></div></section>}
    </div>}

    {report.review.reviewedAt && <footer className="finance-review-stamp"><span>{text.reviewed}</span><strong>{report.review.reviewedBy?.name}</strong><time>{formatEventDateTime(report.review.reviewedAt, event.timeZone, language)}</time>{report.review.notes && <p>{report.review.notes}</p>}</footer>}
  </section>;
}
