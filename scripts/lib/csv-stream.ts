import { parse } from "csv-parse";
import { Readable } from "node:stream";

// Stream a remote CSV row by row, so a large file (the museum open-data dumps
// run to 80MB+) is never held in memory whole. The callback is invoked once
// per row with the parsed column map.
export async function streamCsv(
  url: string,
  onRow: (row: Record<string, string>) => void,
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`CSV download ${url}: ${res.status} ${res.statusText}`);
  }
  const parser = parse({ columns: true, skip_empty_lines: true, bom: true });
  // res.body is a web ReadableStream; bridge it to a Node stream so pipe()
  // handles backpressure for us.
  const node = Readable.fromWeb(
    res.body as unknown as Parameters<typeof Readable.fromWeb>[0],
  );
  node.pipe(parser);
  for await (const row of parser) {
    onRow(row as Record<string, string>);
  }
}
