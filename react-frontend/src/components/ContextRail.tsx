import { workspaceAttention } from "../attention";
import { useI18n } from "../i18n";
import type { Division, EventData, EventReport, Registration, Workspace } from "../types";

type Props = { workspace: Workspace; division: Division; event: EventData; registrations: Registration[]; report: EventReport | null };

export default function ContextRail({ workspace, division, event, registrations, report }: Props) {
  const { t } = useI18n(); const audit = report?.auditLog || [];
  const items = workspaceAttention(workspace, division, event, registrations, audit);

  return <aside className="context-rail">
    <section className="rail-card attention-card"><header><h2>{t("attention.title")}</h2><span>{items.reduce((sum, item) => sum + item.count, 0)}</span></header>{items.length ? <div className="attention-list">{items.map((item) => <article className={`attention-item ${item.tone}`} key={item.key}><i>{item.count}</i><div><strong>{t(`attention.${item.key}`)}</strong><small>{t(`attention.${item.key}Help`)}</small></div></article>)}</div> : <p className="empty-copy">{t("attention.clear")}</p>}</section>
  </aside>;
}
