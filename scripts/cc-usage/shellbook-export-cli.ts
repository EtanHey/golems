import { buildShellbookUsageExport } from "./shellbook-export";
import { fetchRawUsageRows } from "./supabase-reader";

export interface ShellbookExportCliOptions {
  fromDate?: string;
}

function flagValue(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = args.indexOf(name);
  if (index !== -1) return args[index + 1];
  return undefined;
}

function dateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function parseShellbookExportArgs(
  args: string[],
): ShellbookExportCliOptions {
  const fromDate = flagValue(args, "--from");
  if (fromDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
      throw new Error("--from must be YYYY-MM-DD");
    }
    return { fromDate };
  }

  const daysValue = flagValue(args, "--days");
  if (daysValue !== undefined) {
    const days = Number(daysValue);
    if (!Number.isInteger(days) || days <= 0) {
      throw new Error("--days must be a positive integer");
    }
    return { fromDate: dateDaysAgo(days) };
  }

  return {};
}

export async function runShellbookExportCli(args: string[]) {
  const opts = parseShellbookExportArgs(args);
  const rows = await fetchRawUsageRows(opts);
  const exported = buildShellbookUsageExport(rows);
  console.log(JSON.stringify(exported));
}
