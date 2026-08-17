"use client";

import { useEffect, useState } from "react";
import { getPhoto } from "@/core/capture";
import styles from "../capture.module.css";

interface PhotoThumbProps {
  photoId: string;
  onRemove: () => void;
}

export function PhotoThumb({ photoId, onRemove }: PhotoThumbProps) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    getPhoto(photoId).then((photo) => {
      if (cancelled || !photo) return;
      objectUrl = URL.createObjectURL(photo.blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId]);

  return (
    <div className={styles.photoThumbWrap}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- local blob: URL, next/image cannot optimize it
        <img src={url} alt="Captured damage photo" className={styles.photoThumb} />
      ) : (
        <div className={styles.photoThumb} aria-hidden="true" />
      )}
      <button
        type="button"
        className={styles.photoRemoveButton}
        onClick={onRemove}
        aria-label="Remove photo"
      >
        ×
      </button>
    </div>
  );
}
