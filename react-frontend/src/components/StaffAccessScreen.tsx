import { brandAssets } from "../brand";
import { useI18n } from "../i18n";
import { Alert, Button, Input, SegmentedControl, Select } from "./ui";

type Props = {
  accessCode: string;
  setAccessCode: (value: string) => void;
  staffName: string;
  setStaffName: (value: string) => void;
  role: string;
  setRole: (value: string) => void;
  onLogin: () => Promise<void>;
  busy: boolean;
  error: string;
};

export default function StaffAccessScreen({ accessCode, setAccessCode, staffName, setStaffName, role, setRole, onLogin, busy, error }: Props) {
  const { language, setLanguage, t } = useI18n();
  const ready = Boolean(accessCode.trim() && staffName.trim() && role.trim());
  const roles = language === "ja" ? [["General staff", "一般スタッフ"], ["Judge", "審査員"], ["Event lead", "イベント責任者"], ["Finance lead", "会計責任者"], ["Check-in", "受付"], ["Tournament board", "トーナメント運営"], ["Floor display", "フロア表示"], ["Event records", "イベント記録"]] : [["General staff", "General staff"], ["Judge", "Judge"], ["Event lead", "Event lead"], ["Finance lead", "Finance lead"], ["Check-in", "Check-in"], ["Tournament board", "Tournament board"], ["Floor display", "Floor display"], ["Event records", "Event records"]];

  return <main className="access-shell">
    <section className="access-workspace">
      <div className="access-panel">
      <header className="access-topbar"><div className="access-brand" translate="no"><img src={brandAssets.lockup} alt="CHIP CHOP" width="3604" height="846" fetchPriority="high" /><span>THE MENYU</span></div><SegmentedControl className="access-language" ariaLabel={language === "ja" ? "表示言語" : "Language"} value={language} onChange={(item) => setLanguage(item as "en" | "ja")} items={[{ id: "en", label: "EN" }, { id: "ja", label: "日本語" }]} /></header>
      <form className="access-card" onSubmit={(event) => { event.preventDefault(); if (ready && !busy) onLogin(); }}>
        <div className="access-heading"><h1>{language === "ja" ? "スタッフサインイン" : "Staff sign in"}</h1><p>{language === "ja" ? "共有アクセスコードを入力して、当日の運営を始めます。" : "Enter the shared access code to begin event operations."}</p></div>
        <div className="access-fields">
          <label className="field"><span>{t("app.staffName")}</span><Input name="staff-name" value={staffName} onChange={(event) => setStaffName(event.target.value)} autoComplete="name" /></label>
          <label className="field"><span>{t("app.roles")}</span><Select name="staff-role" value={role} onChange={(event) => setRole(event.target.value)}>{roles.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></label>
          <label className="field"><span>{t("app.accessCode")}</span><Input name="staff-access-code" type="password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} autoComplete="off" spellCheck={false} /></label>
        </div>
        {error && <Alert tone="danger" className="access-error">{error}</Alert>}
        <Button variant="primary" size="lg" full type="submit" disabled={busy || !ready}>{busy ? t("app.checking") : (language === "ja" ? "スタッフデスクを開く" : "Enter staff desk")}</Button>
      </form>
      <img className="access-mascot" src={brandAssets.egg} alt="" aria-hidden="true" width="650" height="900" />
      </div>
    </section>
  </main>;
}
