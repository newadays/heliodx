/** Numbers in evidence and prose render in mono, tabular (design: "value · limit"). */
import { Fragment } from "react";

const NUMBER = /(\d+(?:\.\d+)?%?(?:\s\/\s\d+(?:\.\d+)?)?)/g;

export function MonoNumbers({ text }: { text: string }) {
  const parts = text.split(NUMBER);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="mono">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
