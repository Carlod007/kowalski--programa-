import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import type { Transaction } from "@/types/transaction";
import { buildHistoryRows, summarizeHistoryRows } from "@/utils/historyExport";

vi.mock("@/lib/firebase", () => ({ db: null }));

import { buildHistoryXlsx } from "./historyXlsxService";

const registered = new Date(2026, 8, 26, 17, 5);
const base = {
  localDate: registered.toISOString(), serverDate: null,
  transactionDate: "2026-09-26",
};

const transactions = [
  {
    ...base, type: "income", source: "=SUM(A1:A2)", description: "@nota",
    amountCents: 10001, distribution: { necesidad: 5000, ocio: 3000, ahorro: 2001 },
  },
  {
    ...base, type: "expense", transactionDate: "2026-09-25",
    category: "ocio", subcategory: "+1", paymentMethod: "Yape",
    description: "=HYPERLINK(\"https://example.com\")", amountCents: 2000,
  },
  {
    ...base, type: "expense", category: "ocio", subcategory: "Taxi",
    paymentMethod: "Efectivo", amountCents: 305,
  },
  {
    ...base, type: "loan", loanId: "loan-1", lender: "Banco",
    destinationCategory: "necesidad", amountCents: 4001,
  },
] as Transaction[];

describe("exportación Excel del historial", () => {
  it("transforma montos, fechas y textos sin alterar centavos ni signos", () => {
    const rows = buildHistoryRows(transactions);
    expect(rows.map((row) => row.amountCents)).toEqual([10001, 2000, 305, 4001]);
    expect(rows.map((row) => row.amountSoles)).toEqual([100.01, 20, 3.05, 40.01]);
    expect(rows.map((row) => row.type)).toEqual(["Ingreso", "Egreso", "Egreso", "Ingreso"]);
    expect(rows[0].operationDate).toBeNull();
    expect(rows[1].operationDate?.toISOString()).toBe("2026-09-25T00:00:00.000Z");
    expect(rows[1].recordedDate?.toISOString()).toBe("2026-09-26T00:00:00.000Z");
    expect(rows[1].recordedTime).toBe("17:05");
    expect(rows[0].moneyOrigin).toBe("=SUM(A1:A2)");
    expect(rows[1].subcategory).toBe("+1");
    expect(rows[1].note).toBe('=HYPERLINK("https://example.com")');
    expect(summarizeHistoryRows(rows)).toEqual({
      incomeCents: 14002, expenseCents: 2305, loanReceiptCents: 4001,
      categoryCents: { necesidad: 0, ocio: 2305, ahorro: 0 },
    });
  });

  it("conserva tipos, formatos, anchos, filtros y fila fija al releer el xlsx", async () => {
    const bytes = await buildHistoryXlsx(buildHistoryRows(transactions));
    const readback = new ExcelJS.Workbook();
    await readback.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
    expect(readback.worksheets.map((sheet) => sheet.name)).toEqual(["Historial", "Resumen"]);
    const history = readback.getWorksheet("Historial")!;
    const summary = readback.getWorksheet("Resumen")!;
    expect(history.rowCount).toBe(5);
    expect(history.hasMerges).toBe(false);
    expect(summary.hasMerges).toBe(false);
    expect(history.getCell("A2").value).toBeNull();
    expect(history.getCell("A3").value).toBeInstanceOf(Date);
    expect((history.getCell("A3").value as Date).toISOString()).toBe("2026-09-25T00:00:00.000Z");
    expect(history.getCell("B2").value).toBeInstanceOf(Date);
    expect(history.getCell("A3").numFmt).toBe("dd/mm/yyyy");
    expect(history.getCell("B2").numFmt).toBe("dd/mm/yyyy");
    expect(history.getCell("I2").value).toBe(100.01);
    expect(history.getCell("I3").value).toBe(20);
    expect(history.getCell("I2").numFmt).toBe('"S/ "#,##0.00');
    expect(history.getCell("H2").value).toBe("=SUM(A1:A2)");
    expect(history.getCell("F3").value).toBe("+1");
    expect(history.getCell("J3").value).toBe('=HYPERLINK("https://example.com")');
    expect(history.getCell("H2").type).toBe(ExcelJS.ValueType.String);
    expect(history.getCell("J3").type).toBe(ExcelJS.ValueType.String);
    expect(history.getCell("J3").numFmt).toBe("@");
    expect(history.getRow(1).getCell(1).font.bold).toBe(true);
    expect(history.getRow(1).getCell(1).fill).toMatchObject({ type: "pattern", pattern: "solid" });
    expect(history.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(history.autoFilter).toBe("A1:J5");
    expect(history.getColumn(1).width).toBe(22);
    expect(history.getColumn(10).width).toBe(42);
    expect(summary.getCell("B5").value).toBe(140.02);
    expect(summary.getCell("B6").value).toBe(23.05);
    expect(summary.getCell("B7").value).toBe(40.01);
    expect(summary.getCell("B11").value).toBe(23.05);
    expect(summary.getCell("B5").numFmt).toBe('"S/ "#,##0.00');
    expect(summary.getCell("B5").type).toBe(ExcelJS.ValueType.Number);
    expect(summary.getCell("A4").font.bold).toBe(true);
    console.info("XLSX reabierto:", {
      sheets: readback.worksheets.map((sheet) => sheet.name),
      dates: [history.getCell("A3").numFmt, history.getCell("B2").numFmt],
      money: history.getCell("I2").numFmt,
      text: history.getCell("J3").numFmt,
      widths: [history.getColumn(1).width, history.getColumn(10).width],
      frozen: history.views[0], filter: history.autoFilter,
      summary: { income: summary.getCell("B5").value, expense: summary.getCell("B6").value },
    });
  });
});
