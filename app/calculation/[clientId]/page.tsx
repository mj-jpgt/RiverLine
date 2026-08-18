import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { elementsForOccupancy } from "@/core/capture";
import {
  computeAndPersistCalculation,
  getLatestCalculationView,
  type CalculationView,
  type StructureValueInfo,
} from "../_lib/compute";
import { RecomputeButton } from "./_components/RecomputeButton";
import motion from "@/shared/ui/motion.module.css";
import styles from "./calculation.module.css";

// The calculation view (M3, T-C4): assessor-facing surface shown after a
// synced assessment. Officials get the full review/adoption screen in
// T-C5 (src/core/determination/) — this page's job is to show what the
// engine computed and every input that fed it, honestly, including the
// two documented data gaps (specs/constitution.md §2) as explicit states
// rather than silently computing a wrong or fabricated number.

const VALUE_SOURCE_LABELS: Record<string, string> = {
  assessed_improvement: "Assessed improvement value — market value pending, see official",
  assessed_total: "Assessed total value (land + improvements)",
  assessed_adjusted: "Assessed value, adjusted",
  appraisal: "Independent appraisal",
  official_override: "Set by official override",
};

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

const STATUS_LABEL: Record<CalculationView["calculation"]["thresholdResult"], string> = {
  NOT_SD: "Not substantial damage",
  BORDERLINE: "Borderline",
  SD: "Substantial damage",
};

// CSS module class lookups go through an index signature typed
// `[className: string]: string` (global.d.ts) which, under
// noUncheckedIndexedAccess, TypeScript widens to `string | undefined` even
// for a literal dot-access — the class is always present at runtime
// (defined in calculation.module.css), so the `as string` cast below is
// safe, matching the class name to its CSS source directly beside it.
function statusClass(threshold: CalculationView["calculation"]["thresholdResult"]): string {
  switch (threshold) {
    case "NOT_SD":
      return styles.statusBadgeNotSd as string;
    case "BORDERLINE":
      return styles.statusBadgeBorderline as string;
    case "SD":
      return styles.statusBadgeSd as string;
  }
}

function StructureIncompleteState({ structure }: { structure: StructureValueInfo }) {
  return (
    <main className={`${styles.main} ${motion.pageEnter}`}>
      <PageHeader structure={structure} />
      <div className={styles.blockedPanel} role="status">
        <h2 className={styles.blockedHeading}>Structure attributes incomplete</h2>
        <p className={styles.blockedText}>
          {structure.occupancyType === null
            ? "Occupancy type has not been set for this structure. "
            : "Square footage has not been recorded for this structure. "}
          The calculation cannot run until it is. Go back to the structure record and complete it, or resume the
          assessment to fill it in.
        </p>
      </div>
    </main>
  );
}

function NoCostTableState({ structure }: { structure: StructureValueInfo }) {
  return (
    <main className={`${styles.main} ${motion.pageEnter}`}>
      <PageHeader structure={structure} />
      <div className={styles.blockedPanel} role="status">
        <h2 className={styles.blockedHeading}>No cost table loaded</h2>
        <p className={styles.blockedText}>
          This jurisdiction has no cost table on file yet, so the 50%-rule calculation cannot run. The assessment
          itself is saved — nothing is lost. A cost-estimating guide must be selected and loaded before a
          calculation can be produced. See <span className={styles.blockedCode}>docs/BLOCKERS.md B1</span> for what
          is blocking this and the recommended next step.
        </p>
      </div>
    </main>
  );
}

function NoValueState({ structure }: { structure: StructureValueInfo }) {
  return (
    <main className={`${styles.main} ${motion.pageEnter}`}>
      <PageHeader structure={structure} />
      <div className={styles.blockedPanel} role="status">
        <h2 className={styles.blockedHeading}>No value available</h2>
        <p className={styles.blockedText}>
          Neither an assessed market value nor an improvement value is on file for this structure, so there is no
          denominator for the ratio. An official must set a value before this calculation can run.
        </p>
      </div>
    </main>
  );
}

function PageHeader({ structure }: { structure: StructureValueInfo }) {
  return (
    <>
      <Link href={`/registry/${structure.id}`} className={styles.backLink}>
        ← Back to structure
      </Link>
      <div className={styles.header}>
        <p className={styles.eyebrow}>50% rule calculation</p>
        <h1 className={styles.heading}>{structure.address}</h1>
      </div>
    </>
  );
}

function CalculationDetail({ view, clientId }: { view: CalculationView; clientId: string }) {
  const { calculation, elements, structure, costTable, priorCalculationCount } = view;
  const elementDefs = structure.occupancyType ? elementsForOccupancy(structure.occupancyType) : [];
  const nameFor = (code: string) => elementDefs.find((e) => e.code === code)?.name ?? code;
  const valueSourceLabel = VALUE_SOURCE_LABELS[calculation.valueSource] ?? calculation.valueSource;

  return (
    <main className={`${styles.main} ${motion.pageEnter}`}>
      <PageHeader structure={structure} />

      {priorCalculationCount > 0 ? (
        <p className={styles.historyNote}>
          This is calculation #{priorCalculationCount + 1} for this assessment. Earlier calculations remain on file
          (calculations are never edited or deleted — AGENTS.md rule 10).
        </p>
      ) : null}

      <section className={styles.resultCard} aria-label="Calculation result">
        <p className={styles.ratioValue}>{formatPercent(calculation.ratio)}</p>
        <p className={styles.ratioLabel}>Damage-to-value ratio</p>
        <span className={statusClass(calculation.thresholdResult)}>
          <span className={styles.statusDot} aria-hidden="true" />
          {STATUS_LABEL[calculation.thresholdResult]}
        </span>
        <p className={styles.legalLine}>
          The regulatory substantial damage threshold is 50% of market value.
        </p>
        {calculation.thresholdResult === "BORDERLINE" ? (
          <p className={styles.borderlineNote}>
            Within calculation tolerance — requires official review.
          </p>
        ) : null}
      </section>

      <div className={styles.actions}>
        <RecomputeButton clientId={clientId} />
      </div>

      <section className={styles.card} aria-label="Calculation inputs">
        <h2 className={styles.cardHeading}>Inputs used</h2>
        <dl className={styles.grid}>
          <div>
            <dt className={styles.dt}>Total repair cost</dt>
            <dd className={styles.ddMono}>{formatCurrency(calculation.totalRepairCost)}</dd>
          </div>
          <div>
            <dt className={styles.dt}>Market value used</dt>
            <dd className={styles.ddMono}>{formatCurrency(calculation.marketValueUsed)}</dd>
          </div>
          <div>
            <dt className={styles.dt}>Cost table version</dt>
            <dd className={styles.ddMono}>{costTable.version}</dd>
          </div>
          <div>
            <dt className={styles.dt}>Engine version</dt>
            <dd className={styles.ddMono}>{calculation.engineVersion}</dd>
          </div>
        </dl>
        <p className={styles.sourceNote}>
          Value source: {valueSourceLabel}
          {costTable.sourceCitation ? (
            <>
              <br />
              Cost table source: {costTable.sourceCitation}
              {costTable.effectiveDate ? ` (effective ${costTable.effectiveDate})` : ""}
            </>
          ) : null}
          <br />
          Computed {new Date(calculation.computedAt).toLocaleString("en-US")}
        </p>
      </section>

      <section className={styles.card} aria-label="Per-element breakdown">
        <h2 className={styles.cardHeading}>Per-element breakdown</h2>
        {elements.length === 0 ? (
          <p className={styles.dt}>Breakdown unavailable for this calculation&apos;s cost table version.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Element</th>
                  <th scope="col" className={styles.numCell}>
                    $/sqft
                  </th>
                  <th scope="col" className={styles.numCell}>
                    Repair cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {elements.map((el) => (
                  <tr key={el.element_code}>
                    <td>{nameFor(el.element_code)}</td>
                    <td className={styles.numCell}>{formatCurrency(el.base_cost)}</td>
                    <td className={styles.numCell}>{formatCurrency(el.computed_cost)}</td>
                  </tr>
                ))}
                <tr className={styles.totalRow}>
                  <td>Total</td>
                  <td />
                  <td className={styles.numCell}>{formatCurrency(calculation.totalRepairCost)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default async function CalculationPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
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

  const view = await getLatestCalculationView(guarded.jurisdictionId, guarded.userId, clientId);

  if (view.status === "no_assessment") {
    notFound();
  }

  if (view.status === "structure_incomplete") {
    return <StructureIncompleteState structure={view.structure} />;
  }

  if (view.status === "has_calculation") {
    return <CalculationDetail view={view} clientId={clientId} />;
  }

  // status === "no_calculation_yet": first view after sync is the
  // automatic trigger (task requirement 2, "when an assessment syncs
  // complete ... look up the ACTIVE cost table ... run engine, INSERT a
  // calculations row"). This is the one place a page render causes a
  // write; every subsequent view of this same URL hits "has_calculation"
  // above and reads only.
  const computed = await computeAndPersistCalculation(guarded.jurisdictionId, guarded.userId, clientId);

  if (computed.status === "no_cost_table") {
    return <NoCostTableState structure={computed.structure} />;
  }
  if (computed.status === "no_value") {
    return <NoValueState structure={computed.structure} />;
  }
  if (computed.status === "structure_incomplete") {
    return <StructureIncompleteState structure={computed.structure} />;
  }
  if (computed.status === "no_assessment") {
    notFound();
  }

  return <CalculationDetail view={computed} clientId={clientId} />;
}
