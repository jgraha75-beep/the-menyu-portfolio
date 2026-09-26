import type { ChangeEvent, FormEvent } from "react";
import { useI18n } from "../../i18n";
import type { Division, EventDivisionConfiguration, ImportPreview, Registration } from "../../types";
import { Alert, Button, Input, Modal, Textarea } from "../ui";

export type WalkInDraft = {
  name: string;
  members: string;
  email: string;
  instagram: string;
  dob: string;
  parentName: string;
};

type WalkInDialogProps = {
  division: Division;
  divisionSettings: EventDivisionConfiguration;
  draft: WalkInDraft;
  busy: boolean;
  onChange: (draft: WalkInDraft) => void;
  onSubmit: () => void;
  onClose: () => void;
};

export function WalkInDialog({ division, divisionSettings, draft, busy, onChange, onSubmit, onClose }: WalkInDialogProps) {
  const { t } = useI18n();
  const set = (field: keyof WalkInDraft, value: string) => onChange({ ...draft, [field]: value });
  const teamEvent = divisionSettings.teamSize > 1;
  const ready = Boolean(draft.name.trim() && (!teamEvent || draft.members.trim()));

  return <Modal
    title={t("checkin.addWalkIn")}
    eyebrow="DOOR ENTRY"
    closeLabel={t("common.close")}
    onClose={onClose}
    actions={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" disabled={busy || !ready} onClick={onSubmit}>{t("checkin.createWalkIn")}</Button></>}
  >
    <div className="arrival-dialog-intro">
      <span aria-hidden="true">＋</span>
      <div><strong>{divisionSettings.name}</strong><p>{t("checkin.currentFee", { amount: `¥${divisionSettings.financial.sameDayEntryFee.toLocaleString()}` })} · {t("checkin.firstDrink")}</p></div>
    </div>
    <div className="arrival-form-grid">
      <label className="field">
        <span>{teamEvent ? t("checkin.teamName") : t("checkin.battlerName")}</span>
        <Input value={draft.name} onChange={(event) => set("name", event.target.value)} />
      </label>
      {teamEvent && <label className="field arrival-field-wide">
        <span>{t("checkin.memberNames")}</span>
        <Input value={draft.members} onChange={(event) => set("members", event.target.value)} placeholder="Name one, Name two" />
      </label>}
      <label className="field">
        <span>{t("checkin.email")} <i>{t("common.optional")}</i></span>
        <Input type="email" value={draft.email} onChange={(event) => set("email", event.target.value)} />
      </label>
      <label className="field">
        <span>{t("checkin.instagram")} <i>{t("common.optional")}</i></span>
        <Input value={draft.instagram} onChange={(event) => set("instagram", event.target.value)} />
      </label>
      {!teamEvent && <>
        <label className="field">
          <span>{t("checkin.dob")} <i>{t("common.optional")}</i></span>
          <Input type="date" value={draft.dob} onChange={(event) => set("dob", event.target.value)} />
        </label>
        <label className="field">
          <span>{t("checkin.parent")} <i>{t("common.optional")}</i></span>
          <Input value={draft.parentName} onChange={(event) => set("parentName", event.target.value)} />
        </label>
      </>}
    </div>
    {!ready && <p className="arrival-required-help">{t("checkin.walkInRequired")}</p>}
  </Modal>;
}

type CsvDialogProps = {
  division: Division;
  divisionSettings: EventDivisionConfiguration;
  file: File | null;
  preview: ImportPreview | null;
  previewBusy: boolean;
  applyBusy: boolean;
  onFileChange: (file: File | null) => void;
  onPreview: () => void;
  onApply: () => void;
  onClose: () => void;
};

export function CsvDialog({ division, divisionSettings, file, preview, previewBusy, applyBusy, onFileChange, onPreview, onApply, onClose }: CsvDialogProps) {
  const { t } = useI18n();
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => onFileChange(event.target.files?.[0] || null);
  const busy = previewBusy || applyBusy;

  return <Modal
    title={t("checkin.importPreview")}
    eyebrow="IMPORT"
    closeLabel={t("common.close")}
    onClose={onClose}
    size="sm"
    actions={<><Button onClick={onClose}>{t("common.cancel")}</Button>{preview?.canImport ? <Button variant="primary" busy={applyBusy} busyLabel={t("state.saving")} onClick={onApply}>{t("checkin.importApply")}</Button> : <Button variant="primary" busy={previewBusy} busyLabel={t("checkin.importReview")} disabled={busy || !file} onClick={onPreview}>{t("checkin.importReview")}</Button>}</>}
  >
    <div className="arrival-dialog-intro arrival-dialog-intro--csv">
      <span aria-hidden="true">FILE</span>
      <div><strong>{divisionSettings.name}</strong><p>{t("checkin.importNoChanges")}</p></div>
    </div>
    <label className="arrival-file-drop">
      <input type="file" accept=".csv,.pdf,text/csv,application/pdf" onChange={handleFile} />
      <span aria-hidden="true">CSV / PDF</span>
      <strong>{file?.name || t("checkin.chooseCsv")}</strong>
      <small>{file ? `${Math.max(1, Math.round(file.size / 1024))} KB` : ".CSV or .PDF"}</small>
    </label>
    {preview && <section className="import-preview" aria-live="polite">
      <div className="import-preview__summary"><strong>{preview.recordCount} {t("checkin.registration")}</strong><span>{preview.sourceType === "pdf" ? t("checkin.importSourcePdf") : t("checkin.importSourceCsv")}</span>{preview.skippedRows > 0 && <small>{preview.skippedRows} {t("checkin.importSkipped")}</small>}</div>
      <p className="import-preview__no-changes">{t("checkin.importNoChanges")}</p>
      {preview.errors.length > 0 && <Alert tone="danger" title={t("checkin.importErrors")}><ul>{preview.errors.map((item, index) => <li key={`${item.code}-${item.row}-${index}`}>{item.message}</li>)}</ul></Alert>}
      {preview.warnings.length > 0 && <Alert tone="warn" title={`${t("checkin.importWarnings")} · ${preview.warnings.length}`}><ul>{preview.warnings.map((item, index) => <li key={`${item.code}-${item.row}-${index}`}>{item.message}</li>)}</ul></Alert>}
      <div className="import-preview__mapping"><span className="ui-eyebrow">{t("checkin.importMapping")}</span>{Object.entries(preview.mapping).filter(([, value]) => value).map(([key, value]) => <span key={key}><b>{key}</b>{value}</span>)}</div>
      {preview.records.length > 0 && <div className="import-preview__rows"><div><b>No.</b><b>{divisionSettings.teamSize > 1 ? t("checkin.teamName") : t("checkin.battlerName")}</b><b>{t("checkin.memberNames")}</b><b>{t("checkin.status")}</b></div>{preview.records.slice(0, 8).map((record) => <div key={`${record.sourceRow}-${record.sourceNumber}`}><span>{record.sourceNumber || "—"}</span><strong>{record.teamName || record.entryName}</strong><span>{record.memberNames || "—"}</span><span>{record.needsReview ? t("checkin.needsReview") : "OK"}</span></div>)}{preview.records.length > 8 && <small>{preview.records.length - 8} more…</small>}</div>}
    </section>}
  </Modal>;
}

type RegistrationDialogProps = {
  saveLabel?: string;
  registration: Registration;
  busy: boolean;
  onChange: (registration: Registration) => void;
  onSubmit: () => void;
  onClose: () => void;
};

export function RegistrationDialog({ registration, busy, onChange, onSubmit, onClose, saveLabel }: RegistrationDialogProps) {
  const { t } = useI18n();
  const set = <K extends keyof Registration>(field: K, value: Registration[K]) => onChange({ ...registration, [field]: value });
  const formId = "arrival-registration-editor";
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit(); };

  return <Modal
    title={registration.teamName || registration.entryName || registration.displayCode}
    eyebrow={`${t("checkin.editRegistration")} · ${registration.displayCode}`}
    closeLabel={t("common.close")}
    onClose={onClose}
    size="lg"
    actions={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" type="submit" form={formId} disabled={busy}>{saveLabel || t("common.save")}</Button></>}
  >
    <form id={formId} onSubmit={submit} className="arrival-form-grid arrival-form-grid--editor">
      {registration.members.length > 1 ? <>
        <label className="field">
          <span>{t("checkin.teamName")}</span>
          <Input value={registration.teamName} onChange={(event) => set("teamName", event.target.value)} />
        </label>
        <label className="field">
          <span>{t("checkin.memberNames")}</span>
          <Input value={registration.memberNames} onChange={(event) => set("memberNames", event.target.value)} />
        </label>
        <label className="field arrival-field-wide">
          <span>{t("checkin.instagram")}</span>
          <Input value={registration.instagramTeam} onChange={(event) => set("instagramTeam", event.target.value)} />
        </label>
        {registration.members.map((member, index) => <label className="field" key={`${registration.id}-instagram-${index}`}>
          <span>{member.name || `${t("checkin.member")} ${index + 1}`} Instagram</span>
          <Input value={registration.instagramMembers[index] || ""} onChange={(event) => {
            const next = [...registration.instagramMembers];
            next[index] = event.target.value;
            set("instagramMembers", next);
          }} />
        </label>)}
      </> : <>
        <label className="field">
          <span>{t("checkin.battlerName")}</span>
          <Input value={registration.entryName} onChange={(event) => set("entryName", event.target.value)} />
        </label>
        <label className="field">
          <span>{t("checkin.instagram")}</span>
          <Input value={registration.instagramMembers[0] || ""} onChange={(event) => set("instagramMembers", [event.target.value])} />
        </label>
        <label className="field">
          <span>{t("checkin.dob")}</span>
          <Input type="date" value={registration.dob} onChange={(event) => set("dob", event.target.value)} />
        </label>
        <label className="field">
          <span>{t("checkin.parent")}</span>
          <Input value={registration.parentName} onChange={(event) => set("parentName", event.target.value)} />
        </label>
      </>}
      <label className="field">
        <span>{t("checkin.email")}</span>
        <Input type="email" value={registration.email} onChange={(event) => set("email", event.target.value)} />
      </label>
      <label className="field">
        <span>{t("checkin.phone")}</span>
        <Input value={registration.phone} onChange={(event) => set("phone", event.target.value)} />
      </label>
      <label className="field">
        <span>{t("checkin.genre")}</span>
        <Input value={registration.genre} onChange={(event) => set("genre", event.target.value)} />
      </label>
      <label className="field">
        <span>{t("checkin.region")}</span>
        <Input value={registration.region} onChange={(event) => set("region", event.target.value)} />
      </label>
      <label className="field arrival-field-wide">
        <span>{t("checkin.notes")}</span>
        <Textarea value={registration.notes} onChange={(event) => set("notes", event.target.value)} />
      </label>
      <label className="arrival-review-toggle arrival-field-wide">
        <input type="checkbox" checked={registration.needsReview} onChange={(event) => set("needsReview", event.target.checked)} />
        <span><strong>{t("checkin.keepReview")}</strong><small>{registration.reviewReasons.join(" · ") || t("checkin.noNotes")}</small></span>
      </label>
    </form>
  </Modal>;
}
