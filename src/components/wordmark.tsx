// The Dartabase wordmark. "art" is held in full ink while the surrounding
// letters recede, a quiet nod to the word hidden in the name.
export function Wordmark({ size = "sm" }: { size?: "sm" | "lg" }) {
  return (
    <span
      className={`font-mono uppercase tracking-[0.18em] ${
        size === "lg" ? "text-base" : "text-sm"
      }`}
    >
      <span className="text-muted">d</span>
      <span className="font-medium text-ink">art</span>
      <span className="text-muted">abase</span>
    </span>
  );
}
