/** Demo accounts add a curated NIH sample to the worklist; its analysis runs live (F11). */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { createDemoStudy, listSamples, warmModels, type DemoSample } from "~/data/actions";
import { useStorageUrl } from "~/data/hooks";

import { Icon } from "./Icon";
import { useToast } from "./Toast";

function SampleTile({ sample, busy, onPick }: { sample: DemoSample; busy: boolean; onPick: () => void }) {
  const url = useStorageUrl(sample.storagePath);
  const who = [sample.age && sample.sex ? `${sample.age} ${sample.sex}` : null, sample.view ?? null].filter(Boolean).join(" · ");
  return (
    <button type="button" className="sample" onClick={onPick} disabled={busy} aria-label={`Add ${sample.title}${who ? `, ${who}` : ""}`}>
      <span className="sample__img">{url ? <img src={url} alt="" /> : null}</span>
      <span className="sample__text">
        <strong>{sample.title}</strong>
        <span className="muted">{[who, sample.indication].filter(Boolean).join(" · ")}</span>
      </span>
    </button>
  );
}

export function SamplePicker({ onClose }: { onClose: () => void }) {
  const [samples, setSamples] = useState<DemoSample[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    void warmModels();
    listSamples()
      .then(setSamples)
      .catch(() => setSamples([]));
  }, []);

  const pick = async (s: DemoSample) => {
    setBusy(s.id);
    try {
      const id = await createDemoStudy(s.id);
      navigate(`/study/${id}?step=analyzing`);
    } catch (error) {
      const code = (error as { code?: string }).code;
      toast({ message: code === "functions/resource-exhausted" ? "The demo allows 20 samples an hour. Try again later." : "Couldn't add the sample. Try again." });
      setBusy(null);
    }
  };

  return (
    <section className="card picker" aria-label="Add a sample">
      <div className="picker__head">
        <div>
          <span className="label">Add a sample</span>
          <p className="muted">A chest X-ray from the NIH ChestX-ray14 set with a synthetic patient. Analysis starts as soon as you pick one.</p>
        </div>
        <button type="button" className="ib ib-sm" style={{ border: "none" }} aria-label="Close sample picker" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {samples === null ? (
        <p className="muted">Loading samples…</p>
      ) : samples.length ? (
        <div className="picker__grid">
          {samples.map((s) => (
            <SampleTile key={s.id} sample={s} busy={busy !== null} onPick={() => void pick(s)} />
          ))}
        </div>
      ) : (
        <p className="muted">No samples are available.</p>
      )}
    </section>
  );
}
