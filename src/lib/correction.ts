const REPO = "Maltysnack/Dartabase";

export function takedownIssueUrl({
  recordTitle,
  recordUrl,
}: {
  recordTitle: string;
  recordUrl: string;
}): string {
  const title = `Takedown request: ${recordTitle}`;
  const body = [
    `**Record:** [${recordTitle}](${recordUrl})`,
    "",
    "---",
    "",
    "**Requesting organisation or community:**",
    "",
    "**Reason for request:**",
    "",
    "**Preferred action (removal / restricted display / attribution correction):**",
    "",
    "**Contact for follow-up (optional):**",
    "",
    "---",
    "_ICIP and institution takedown requests are prioritised and actioned within 2 business days._",
  ].join("\n");

  const params = new URLSearchParams({
    labels: "data-correction,icip,takedown",
    title,
    body,
  });
  return `https://github.com/${REPO}/issues/new?${params.toString()}`;
}

export function correctionIssueUrl({
  recordType,
  recordTitle,
  recordUrl,
}: {
  recordType: "artwork" | "artist";
  recordTitle: string;
  recordUrl: string;
}): string {
  const title = `Correction: ${recordTitle}`;
  const body = [
    `**Record type:** ${recordType}`,
    `**Record:** [${recordTitle}](${recordUrl})`,
    "",
    "---",
    "",
    "**Field that's wrong:**",
    "",
    "**Correct value:**",
    "",
    "**Source or citation (optional):**",
    "",
    "**Additional notes (optional):**",
  ].join("\n");

  const params = new URLSearchParams({
    labels: "data-correction",
    title,
    body,
  });
  return `https://github.com/${REPO}/issues/new?${params.toString()}`;
}
