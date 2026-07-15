import { z } from "zod";

/**
 * Trading 212's CSV export header, confirmed against a real export from a
 * live account on 2026-07-15. Papaparse with header:true produces objects
 * keyed by these exact strings — every value is a string (possibly empty),
 * numeric/date parsing happens in normalizeCsv.ts, not here.
 */
export const T212_CSV_HEADERS = [
  "Action",
  "Time (UTC)",
  "ISIN",
  "Ticker",
  "Name",
  "Notes",
  "ID",
  "No. of shares",
  "Price / share",
  "Currency (Price / share)",
  "Exchange rate",
  "Total",
  "Currency (Total)",
  "Withholding tax",
  "Currency (Withholding tax)",
  "Currency conversion fee",
  "Currency (Currency conversion fee)",
  "French transaction tax",
  "Currency (French transaction tax)",
] as const;

export const T212CsvRowSchema = z.object({
  Action: z.string(),
  "Time (UTC)": z.string(),
  ISIN: z.string(),
  Ticker: z.string(),
  Name: z.string(),
  Notes: z.string(),
  ID: z.string(),
  "No. of shares": z.string(),
  "Price / share": z.string(),
  "Currency (Price / share)": z.string(),
  "Exchange rate": z.string(),
  Total: z.string(),
  "Currency (Total)": z.string(),
  "Withholding tax": z.string(),
  "Currency (Withholding tax)": z.string(),
  "Currency conversion fee": z.string(),
  "Currency (Currency conversion fee)": z.string(),
  "French transaction tax": z.string(),
  "Currency (French transaction tax)": z.string(),
});
export type T212CsvRow = z.infer<typeof T212CsvRowSchema>;
