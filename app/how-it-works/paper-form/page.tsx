import Link from "next/link";
import { RESIDENTIAL_ELEMENTS, NON_RESIDENTIAL_ELEMENTS, DAMAGE_PCT_PRESETS } from "@/core/capture";
import { PrintButton } from "./PrintButton";
import styles from "./page.module.css";

// T-G2, spec §11.4 (paper fallback): "the capture flow degrades to a
// printable paper form matching the element list, so the process never
// blocks on your uptime." Element lists and damage-percentage presets are
// imported straight from src/core/capture (the same module the live
// capture flow uses), never re-typed here, so this form can never silently
// drift from what the app actually asks for. Print-first: black text on a
// white page, no color-dependent information, no background fills, same
// posture src/modules/a1-letters/pure.ts's renderLetterHtml already takes
// for the determination letter (docs/design/direction.md "Print").
export const metadata = {
  title: "Paper field worksheet",
};

function ElementTable({ heading, elements }: { heading: string; elements: readonly { code: string; name: string }[] }) {
  return (
    <section className={styles.elementSection}>
      <h2 className={styles.elementHeading}>{heading}</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col" className={styles.elementCol}>
              Element
            </th>
            {DAMAGE_PCT_PRESETS.map((pct) => (
              <th key={pct} scope="col" className={styles.pctCol}>
                {pct}%
              </th>
            ))}
            <th scope="col" className={styles.otherCol}>
              Other (write in)
            </th>
            <th scope="col" className={styles.photoCol}>
              Photo taken
            </th>
          </tr>
        </thead>
        <tbody>
          {elements.map((el) => (
            <tr key={el.code}>
              <th scope="row" className={styles.elementCol}>
                {el.name}
              </th>
              {DAMAGE_PCT_PRESETS.map((pct) => (
                <td key={pct} className={styles.pctCol}>
                  <span className={styles.checkbox} aria-hidden="true" />
                </td>
              ))}
              <td className={styles.otherCol}>
                <span className={styles.writeLine} />
              </td>
              <td className={styles.photoCol}>
                <span className={styles.checkbox} aria-hidden="true" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function PaperFormPage() {
  return (
    <main className={styles.main}>
      <div className={styles.screenOnly}>
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          <Link href="/how-it-works">How it works</Link>
          <span aria-hidden="true">/</span>
          <span>Paper field worksheet</span>
        </nav>
        <PrintButton />
        <p className={styles.screenHint}>
          Use the button above, or your browser&apos;s print command, to print this
          page. It is designed to print in black on white on a standard printer.
        </p>
      </div>

      <div className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>RiverLine field assessment worksheet</h1>
          <p className={styles.subtitle}>
            Paper fallback for when the tool cannot be reached in the field. Fill
            this out by hand, then enter it into RiverLine as soon as you are back
            online. This form does not compute a result on its own; the ratio and
            the determination still come from the app once this is entered.
          </p>
        </header>

        <section className={styles.structureHeader}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Address</span>
            <span className={styles.writeLine} />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Parcel ID</span>
            <span className={styles.writeLine} />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Date of assessment</span>
            <span className={styles.writeLine} />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Assessor name</span>
            <span className={styles.writeLine} />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Occupancy type</span>
            <span className={styles.checkboxLabel}>
              <span className={styles.checkbox} aria-hidden="true" /> Residential
              <span className={styles.checkbox} aria-hidden="true" /> Non-residential
            </span>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Foundation type</span>
            <span className={styles.writeLine} />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Stories</span>
            <span className={styles.writeLine} />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Interior water depth</span>
            <span className={styles.writeLine} />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Water depth source</span>
            <span className={styles.checkboxLabel}>
              <span className={styles.checkbox} aria-hidden="true" /> Observed line
              <span className={styles.checkbox} aria-hidden="true" /> Measured
              <span className={styles.checkbox} aria-hidden="true" /> Owner reported
            </span>
          </div>
          <div className={styles.fieldWide}>
            <span className={styles.fieldLabel}>Notes</span>
            <span className={styles.writeLine} />
            <span className={styles.writeLine} />
          </div>
        </section>

        <p className={styles.instructions}>
          Mark one damage-percentage box per element below (the same 0/10/25/50/75/100
          increments the app uses). If the real damage falls between two presets,
          write the exact percentage in the &quot;Other&quot; column instead of
          guessing to the nearest preset. Use one worksheet per structure. Fill in
          only the table that matches the structure&apos;s occupancy type above.
        </p>

        <ElementTable heading="Residential (12 elements)" elements={RESIDENTIAL_ELEMENTS} />
        <ElementTable heading="Non-residential (7 elements)" elements={NON_RESIDENTIAL_ELEMENTS} />

        <section className={styles.exteriorPhoto}>
          <span className={styles.fieldLabel}>Required exterior photo taken</span>
          <span className={styles.checkbox} aria-hidden="true" />
        </section>

        <p className={styles.footerNote}>
          Enter this worksheet into RiverLine as soon as the tool is reachable
          again. The app will compute the repair-cost ratio and route the result
          to official review from what you enter here; nothing on this page is a
          final determination.
        </p>
      </div>
    </main>
  );
}
