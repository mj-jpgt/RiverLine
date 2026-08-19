"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OccupancyType } from "@/core/registry";
import styles from "./page.module.css";

type Status = "idle" | "saving" | "error";

// Occupancy is only editable while it is NULL (task spec) — the assessor
// fills in what the parcel ingest could not determine (unknown/ambiguous
// PROPCLASS, see scripts/preprocess/ingest-parcels.mjs). Once set, the
// server page renders it as read-only text instead of mounting this
// component again.
export function OccupancyEditor({ structureId }: { structureId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function submit(occupancyType: OccupancyType) {
    setStatus("saving");
    setErrorMessage("");
    try {
      const res = await fetch(`/api/registry/${structureId}/occupancy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ occupancyType }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(body?.error ?? "Could not save. Try again.");
        setStatus("error");
        return;
      }
      router.refresh();
    } catch {
      setErrorMessage("Network error. Check your connection and try again.");
      setStatus("error");
    }
  }

  return (
    <div>
      <p className={styles.occupancyPrompt}>
        Not on file. Set the occupancy type observed in the field.
      </p>
      <div className={styles.occupancyButtons}>
        <button
          type="button"
          className={styles.occupancyButton}
          disabled={status === "saving"}
          onClick={() => submit("residential")}
        >
          Residential
        </button>
        <button
          type="button"
          className={styles.occupancyButton}
          disabled={status === "saving"}
          onClick={() => submit("non_residential")}
        >
          Non-residential
        </button>
      </div>
      {status === "error" ? (
        <p className={styles.occupancyError} role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
