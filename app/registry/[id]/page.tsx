import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { getStructureById } from "@/core/registry";
import { OccupancyEditor } from "./OccupancyEditor";
import { EnrichmentPanel } from "./EnrichmentPanel";
import motion from "@/shared/ui/motion.module.css";
import styles from "./page.module.css";

const VALUE_SOURCE_LABELS: Record<string, string> = {
  assessed_improvement:
    "Assessed improvement value. The county assessor's record, not a market value. An official confirms the market value used for the determination.",
  assessed_total: "Assessed total value: land plus improvements, from the county assessor's record.",
  assessed_adjusted: "Assessed value, adjusted by an official.",
  appraisal: "Independent appraisal.",
  official_override: "Entered or confirmed directly by an official, not from an automated source.",
};

function formatCurrency(value: number | null): string {
  if (value === null) return "Not on file";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default async function StructureDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  let guarded;
  try {
    guarded = requireRole(session, ["admin", "assessor", "official", "viewer"]);
  } catch (err) {
    if (err instanceof AuthError) {
      redirect("/login");
    }
    throw err;
  }

  const structure = await getStructureById(guarded.jurisdictionId, guarded.userId, id);
  if (!structure) {
    notFound();
  }

  const valueSourceLabel = VALUE_SOURCE_LABELS[structure.valueSource] ?? structure.valueSource;
  const hasMissingFields =
    structure.improvementValue === null ||
    structure.sqFt === null ||
    structure.yearBuilt === null ||
    structure.stories === null ||
    structure.occupancyType === null;

  return (
    <main className={`${styles.main} ${motion.pageEnter}`}>
      <Link href="/registry" className={styles.backLink}>
        ← Back to search
      </Link>

      <div className={styles.header}>
        <p className={styles.eyebrow}>Parcel {structure.parcelId}</p>
        <h1 className={styles.heading}>{structure.address}</h1>
        {structure.isManualEntry ? (
          <p className={styles.manualBadge}>
            Unverified manual entry. This record was typed in by an assessor because the parcel was
            not found in the county records. Confirm details in the field.
          </p>
        ) : null}
      </div>

      <section className={styles.card} aria-label="Assessed values">
        <h2 className={styles.cardHeading}>Assessed values</h2>
        <dl className={styles.grid}>
          <div>
            <dt className={styles.dt}>Improvement value</dt>
            <dd className={styles.ddMono}>{formatCurrency(structure.improvementValue)}</dd>
          </div>
          <div>
            <dt className={styles.dt}>Market value</dt>
            <dd className={styles.ddMono}>{formatCurrency(structure.assessorMarketValue)}</dd>
          </div>
        </dl>
        <p className={styles.valueSourceNote}>{valueSourceLabel}</p>
        {structure.valueAsOfDate ? (
          <p className={styles.valueAsOf}>As of {structure.valueAsOfDate}</p>
        ) : null}
      </section>

      <section className={styles.card} aria-label="Flood hazard">
        <h2 className={styles.cardHeading}>Flood hazard</h2>
        <dl className={styles.grid}>
          <div>
            <dt className={styles.dt}>SFHA zone</dt>
            <dd className={styles.dd}>{structure.sfhaZone ?? "Not on file"}</dd>
          </div>
          <div>
            <dt className={styles.dt}>FIRM panel</dt>
            <dd className={styles.ddMono}>{structure.firmPanel ?? "Not on file"}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.card} aria-label="Structure attributes">
        <h2 className={styles.cardHeading}>Structure</h2>
        <dl className={styles.grid}>
          <div>
            <dt className={styles.dt}>Square footage</dt>
            <dd className={styles.dd}>{structure.sqFt ? structure.sqFt.toLocaleString("en-US") : "Not on file"}</dd>
          </div>
          <div>
            <dt className={styles.dt}>Year built</dt>
            <dd className={styles.dd}>{structure.yearBuilt ?? "Not on file"}</dd>
          </div>
          <div>
            <dt className={styles.dt}>Stories</dt>
            <dd className={styles.dd}>{structure.stories ?? "Not on file"}</dd>
          </div>
          <div>
            <dt className={styles.dt}>DLGF property class</dt>
            <dd className={styles.dd}>{structure.propClass ?? "Not on file"}</dd>
          </div>
        </dl>

        <div className={styles.occupancyBlock}>
          <p className={styles.dt}>Occupancy</p>
          {structure.occupancyType ? (
            <p className={styles.dd}>
              {structure.occupancyType === "residential" ? "Residential" : "Non-residential"}
            </p>
          ) : (
            <OccupancyEditor structureId={structure.id} />
          )}
        </div>
      </section>

      <EnrichmentPanel structureId={structure.id} hasMissingFields={hasMissingFields} />

      <Link href={`/capture/${structure.id}`} className={styles.startAssessment}>
        Start assessment
      </Link>
    </main>
  );
}
