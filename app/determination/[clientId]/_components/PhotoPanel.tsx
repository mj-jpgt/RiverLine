"use client";

import { useState } from "react";
import type { ReviewPhoto } from "@/core/determination";
import styles from "../review.module.css";

// Photos (thumbnails, click to full) — task requirement 2. Photo bytes are
// served by app/api/photos/[id]/route.ts (jurisdiction-scoped). "Empty" is
// designed, never hidden (docs/design/components.md "Photo side-by-side
// panel" row: "empty (no photo for this element — flag, don't hide)").
export function PhotoPanel({ photos, emptyLabel }: { photos: ReviewPhoto[]; emptyLabel: string }) {
  const [fullPhotoId, setFullPhotoId] = useState<string | null>(null);

  if (photos.length === 0) {
    return <p className={styles.noPhotoNote}>{emptyLabel}</p>;
  }

  return (
    <>
      <div className={styles.photoGrid}>
        {photos.map((photo) => (
          <button
            key={photo.id}
            type="button"
            className={styles.photoThumbButton}
            onClick={() => setFullPhotoId(photo.id)}
            aria-label={`View full-size photo captured ${new Date(photo.capturedAt).toLocaleString("en-US")}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- served
                from our own jurisdiction-scoped API route, not next/image-optimizable */}
            <img src={`/api/photos/${photo.id}`} alt="" className={styles.photoThumb} />
          </button>
        ))}
      </div>

      {fullPhotoId ? (
        <div
          className={styles.lightboxOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="Full-size photo"
          onClick={() => setFullPhotoId(null)}
        >
          <div className={styles.lightboxContent} onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/photos/${fullPhotoId}`} alt="Full-size assessment photo" className={styles.lightboxImage} />
            <button type="button" className={styles.lightboxCloseButton} onClick={() => setFullPhotoId(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
