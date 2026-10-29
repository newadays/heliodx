/**
 * B14 · The radiologist read on Review and Sign: who has it and when it is
 * due, the signed read's note, or (with no read yet) a request button. The
 * readers are simulated; the gate rule is the server's (radiology/gate.ts).
 */
import { useState } from "react";

import type { Study } from "@/types/study";
import { Icon } from "~/components/Icon";
import { useToast } from "~/components/Toast";
import { requestRadiologistRead } from "~/data/actions";
import { useNow } from "~/data/hooks";
import { isSigned, readOf } from "~/data/model";

export function ReadBanner({ study }: { study: Study }) {
  const now = useNow(15_000);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const read = readOf(study, now);
  const signed = isSigned(study);
  if (signed && read.state === "none") return null;

  const request = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await requestRadiologistRead(study.id);
    } catch (error) {
      console.error("[read] request failed", error);
      toast({ message: "Couldn't request the read. Try again.", action: { label: "Retry", onClick: () => void request() } });
    } finally {
      setBusy(false);
    }
  };

  if (read.state === "none") {
    // Only offered while the draft can still be signed.
    const hint = read.need === "request" ? `A radiologist read is required before signing: ${read.reason}.` : read.suggested ? "The coordinator recommends a radiologist read." : null;
    return (
      <div className={`rd-banner ${read.need === "request" ? "rd-banner--need" : ""}`} role="note">
        <Icon name="info" size={14} />
        <span className="rd-banner__text">{hint ?? "Want a second opinion? A radiologist can read this case before you sign."}</span>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void request()}>
          {busy ? "Requesting…" : "Request a radiologist read"}
        </button>
      </div>
    );
  }
  return (
    <div className={`rd-banner ${read.state === "signed" ? "rd-banner--done" : ""}`} role="status">
      <Icon name={read.state === "signed" ? "check" : "clock"} size={14} />
      <span className="rd-banner__text">
        <strong>{read.state === "signed" ? "Radiologist read signed" : "Radiologist read open"}</strong> · {read.line}
        {read.state === "open" ? <span className="muted"> · Signing waits for the read.</span> : null}
      </span>
    </div>
  );
}
