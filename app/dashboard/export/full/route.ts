import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { getFullExportTables, buildCsv, buildZip } from "@/modules/a2-dashboard";
import type { ExportTable } from "@/modules/a2-dashboard";

// "Full export (records request)" — spec §7.6, the APRA duty: every table
// for the jurisdiction, bundled as a ZIP of CSVs plus a manifest. See
// src/modules/a2-dashboard/zip.ts for why hand-rolling a real ZIP (STORE
// method) was chosen over "multiple CSV downloads with a manifest" — it was
// trivially achievable without a new dependency, and a single ZIP is a
// materially better artifact to hand a records requester than N separate
// browser downloads they have to reassemble themselves.
function tableToCsv(table: ExportTable): string {
  const rows = table.rows.map((row) => table.columns.map((c) => row[c]));
  return buildCsv(table.columns, rows);
}

export async function GET() {
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  let guarded;
  try {
    guarded = requireRole(session, ["admin", "official"]);
  } catch (err) {
    if (err instanceof AuthError) {
      return new Response(err.message, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    throw err;
  }

  const tables = await getFullExportTables(guarded.jurisdictionId, guarded.userId);

  const manifestLines = [
    "RiverLine SDD — full jurisdiction records export",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Files in this archive:",
    ...tables.map((t) => `  ${t.tableName}.csv — ${t.rows.length} row(s)`),
    "",
    "Every file is one database table, scoped to this jurisdiction only",
    "(Row-Level Security enforced at the database, not filtered in the app).",
    "Photo binaries are not included — only their metadata (photos.csv).",
  ];

  const entries = [
    { name: "MANIFEST.txt", content: Buffer.from(manifestLines.join("\n") + "\n", "utf8") },
    ...tables.map((t) => ({ name: `${t.tableName}.csv`, content: Buffer.from(tableToCsv(t), "utf8") })),
  ];

  const zip = buildZip(entries);

  return new Response(new Uint8Array(zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="records-request-export-${new Date().toISOString().slice(0, 10)}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
