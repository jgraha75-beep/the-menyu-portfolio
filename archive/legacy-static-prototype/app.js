const demoCSV = `Entry Name,Group Name,Email,Paid?,Status
Midnight Motion,Northside Dance Crew,ava.johnson@example.com,Yes,No
Rhythm Rebels,West End Studio,marcus.lee@example.com,Yes,Yes
The Floor Theory,Independent,nia.williams@example.com,No,No
Step Society,Southside Dancers,daniel.brown@example.com,Yes,No
Groove District,Eastside Movement,sofia.martinez@example.com,Yes,Yes
Velocity,Independent,jordan.taylor@example.com,No,No
House of Flow,Oak Park Collective,camille.robinson@example.com,Yes,No
Next Level,Southside Dance Lab,ethan.davis@example.com,Yes,No
City Shakers,West End Studio,olivia.wilson@example.com,Yes,Yes
Motion Makers,Northside Dance Crew,noah.anderson@example.com,Yes,No`;

let entries = [];
let activeFilter = "all";
const $ = (id) => document.getElementById(id);

function parseCSV(text) {
  const rows = text.trim().split(/\r?\n/).map((line) => {
    const cells = []; let value = ""; let quoted = false;
    for (const char of line) {
      if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) { cells.push(value.trim()); value = ""; }
      else value += char;
    }
    cells.push(value.trim()); return cells;
  });
  const headers = rows.shift().map((h) => h.toLowerCase().replace(/\?/g, "").replace(/\s+/g, " ").trim());
  const index = (name) => headers.findIndex((h) => h === name);
  return rows.filter((row) => row.some(Boolean)).map((row, i) => ({
    id: `${Date.now()}-${i}`,
    entry: row[index("entry name")] || "Unnamed entry",
    group: row[index("group name")] || "Independent",
    email: row[index("email")] || "",
    paid: (row[index("paid")] || "no").toLowerCase() === "yes",
    checked: (row[index("status")] || "no").toLowerCase() === "yes",
    originalStatus: row[index("status")] || "No"
  }));
}

function showNotice(message) { const el = $("notice"); el.textContent = message; el.hidden = false; clearTimeout(showNotice.timer); showNotice.timer = setTimeout(() => { el.hidden = true; }, 4200); }

function render() {
  const query = $("search-input").value.toLowerCase().trim();
  const filtered = entries.filter((item) => {
    const matchesQuery = !query || [item.entry, item.group, item.email].some((v) => v.toLowerCase().includes(query));
    const matchesFilter = activeFilter === "all" || (activeFilter === "ready" && item.paid && !item.checked) || (activeFilter === "checked" && item.checked) || (activeFilter === "attention" && !item.paid);
    return matchesQuery && matchesFilter;
  });
  $("entries-body").innerHTML = filtered.map((item) => `<tr class="${!item.paid ? "attention-row" : ""}">
    <td><div class="entry-name">${escapeHTML(item.entry)}</div></td>
    <td><span class="group">${escapeHTML(item.group)}</span></td>
    <td><span class="email">${escapeHTML(item.email)}</span></td>
    <td><span class="pill ${item.paid ? "pill-paid" : "pill-unpaid"}">${item.paid ? "Paid" : "Unpaid"}</span></td>
    <td><span class="status ${item.checked ? "checked" : ""}"><i class="status-dot"></i>${item.checked ? "Checked in" : "Not checked in"}</span></td>
    <td>${item.checked ? `<button class="check-button checked" disabled>Checked in</button>` : `<button class="check-button" data-check="${item.id}">${item.paid ? "Check in" : "Check in anyway"}</button>`}</td>
  </tr>`).join("");
  $("empty-state").hidden = filtered.length !== 0;
  const total = entries.length, checked = entries.filter((e) => e.checked).length, ready = entries.filter((e) => e.paid && !e.checked).length, attention = entries.filter((e) => !e.paid).length;
  $("total-count").textContent = total; $("checked-count").textContent = checked; $("ready-count").textContent = ready; $("attention-count").textContent = attention;
  $("checked-note").textContent = `${total ? Math.round((checked / total) * 100) : 0}% of entries`;
  $("all-filter-count").textContent = total; $("ready-filter-count").textContent = ready; $("checked-filter-count").textContent = checked; $("attention-filter-count").textContent = attention;
  document.querySelectorAll("[data-check]").forEach((button) => button.addEventListener("click", () => { const item = entries.find((e) => e.id === button.dataset.check); if (item) { item.checked = true; showNotice(`${item.entry} checked in.`); render(); } }));
}

function escapeHTML(value) { return value.replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[char])); }
function loadCSV(text, label) { try { entries = parseCSV(text); if (!entries.length) throw new Error(); render(); showNotice(`${entries.length} entries loaded from ${label}.`); } catch { showNotice("This CSV could not be read. Check that it includes Entry Name, Group Name, Email, Paid?, and Status columns."); } }
function exportCSV() { const rows = [["Entry Name", "Group Name", "Email", "Paid?", "Status"], ...entries.map((e) => [e.entry, e.group, e.email, e.paid ? "Yes" : "No", e.checked ? "Yes" : "No"])]; const csv = rows.map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n"); const blob = new Blob([csv], { type: "text/csv" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "updated_event_entries.csv"; link.click(); URL.revokeObjectURL(link.href); showNotice("Updated CSV exported."); }

$("csv-input").addEventListener("change", (event) => { const file = event.target.files[0]; if (file) { const reader = new FileReader(); reader.onload = () => loadCSV(reader.result, file.name); reader.readAsText(file); } });
$("demo-button").addEventListener("click", () => loadCSV(demoCSV, "demo data")); $("export-button").addEventListener("click", exportCSV); $("search-input").addEventListener("input", render);
document.querySelectorAll(".filter").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll(".filter").forEach((b) => b.classList.remove("active")); button.classList.add("active"); activeFilter = button.dataset.filter; render(); }));
loadCSV(demoCSV, "demo data");
