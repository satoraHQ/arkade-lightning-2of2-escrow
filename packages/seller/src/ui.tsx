import { useState } from 'react';

/** Shorten a long string for display: `head…tail`. */
export function middleEllipsis(s: string, head = 12, tail = 12): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** A button that copies `value` to the clipboard and flashes confirmation. */
export function CopyButton({
  value,
  label = 'copy',
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy-btn"
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          },
          () => {},
        );
      }}
    >
      {copied ? 'copied ✓' : label}
    </button>
  );
}

/**
 * A labeled value with a copy button. `value` is what gets copied; `display`
 * (optional) is what's shown — e.g. a middle-ellipsised version of `value`.
 */
export function CopyField({
  label,
  value,
  display,
  mono = true,
}: {
  label: string;
  value: string;
  display?: string;
  mono?: boolean;
}) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="field-row">
        <span className={mono ? 'mono field-value' : 'field-value'}>
          {display ?? value}
        </span>
        <CopyButton value={value} />
      </div>
    </div>
  );
}
