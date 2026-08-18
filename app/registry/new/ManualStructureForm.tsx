"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OccupancyType } from "@/core/registry";
import styles from "./page.module.css";

type Status = "idle" | "saving" | "error";

export function ManualStructureForm({ initialAddress }: { initialAddress: string }) {
  const router = useRouter();
  const [address, setAddress] = useState(initialAddress);
  const [parcelId, setParcelId] = useState("");
  const [occupancyType, setOccupancyType] = useState<OccupancyType | "">("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!address.trim()) {
      setErrorMessage("Address is required.");
      return;
    }
    setStatus("saving");
    setErrorMessage("");
    try {
      const res = await fetch("/api/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: address.trim(),
          parcelId: parcelId.trim() || null,
          occupancyType: occupancyType || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(body?.error ?? "Could not create the structure. Try again.");
        setStatus("error");
        return;
      }
      const body = (await res.json()) as { structure: { id: string } };
      router.push(`/registry/${body.structure.id}`);
    } catch {
      setErrorMessage("Network error. Check your connection and try again.");
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label htmlFor="address" className={styles.label}>
          Address
        </label>
        <input
          id="address"
          type="text"
          autoComplete="off"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className={styles.input}
          required
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="parcelId" className={styles.label}>
          Parcel number (optional)
        </label>
        <input
          id="parcelId"
          type="text"
          autoComplete="off"
          value={parcelId}
          onChange={(e) => setParcelId(e.target.value)}
          className={styles.input}
          placeholder="Leave blank if unknown"
        />
        <p className={styles.hint}>
          If you know the county parcel number, enter it here. If not, leave this blank; the record
          will be saved without one.
        </p>
      </div>

      <div className={styles.field}>
        <label htmlFor="occupancyType" className={styles.label}>
          Occupancy (optional)
        </label>
        <select
          id="occupancyType"
          value={occupancyType}
          onChange={(e) => setOccupancyType(e.target.value as OccupancyType | "")}
          className={styles.select}
        >
          <option value="">Not sure yet</option>
          <option value="residential">Residential</option>
          <option value="non_residential">Non-residential</option>
        </select>
      </div>

      <button type="submit" className={styles.submitButton} disabled={status === "saving"}>
        {status === "saving" ? "Saving…" : "Save structure"}
      </button>

      {status === "error" ? (
        <p className={styles.errorText} role="alert">
          {errorMessage}
        </p>
      ) : null}
    </form>
  );
}
