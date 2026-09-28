import ExcelJS from "exceljs";
import type { Cell, Worksheet } from "exceljs";
import { getHistoryTransactions } from "@/services/exportService";
import { buildHistoryRows, summarizeHistoryRows } from "@/utils/historyExport";
import type { HistoryExportRow } from "@/utils/historyExport";

const DATE_FORMAT = "dd/mm/yyyy";
const MONEY_FORMAT = '"S/ "#,##0.00';
const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern", pattern: "solid", fgColor: { argb: "FF065F46" },
};

function styleHeader(sheet: Worksheet, rowNumber: number, lastColumn: number): void {
  const row = sheet.getRow(rowNumber);
  row.height = 31;
  for (let column = 1; column <= lastColumn; column += 1) {
    const cell = row.getCell(column);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle", wrapText: true };
  }
}

function setText(cell: Cell, value: string): void {
  // Una cadena simple se guarda como texto de Excel, incluso si empieza por =, + o @.
  cell.value = value;
  cell.numFmt = "@";
}

function addHistorySheet(workbook: ExcelJS.Workbook, rows: HistoryExportRow[]): void {
  const sheet = workbook.addWorksheet("Historial", {
    views: [{ state: "frozen", ySplit: 1, topLeftCell: "A2" }],
  });
  sheet.columns = [
    { header: "Fecha de operación", width: 22 },
    { header: "Registrado el", width: 17 },
    { header: "Hora de registro (24 h)", width: 25 },
    { header: "Tipo", width: 14 },
    { header: "Categoría", width: 22 },
    { header: "Subcategoría", width: 26 },
    { header: "Método de pago", width: 21 },
    { header: "Origen del dinero", width: 34 },
    { header: "Monto", width: 19 },
    { header: "Nota", width: 42 },
  ];
  styleHeader(sheet, 1, 10);

  for (const item of rows) {
    const row = sheet.addRow([]);
    row.getCell(1).value = item.operationDate;
    row.getCell(2).value = item.recordedDate;
    row.getCell(1).numFmt = DATE_FORMAT;
    row.getCell(2).numFmt = DATE_FORMAT;
    setText(row.getCell(3), item.recordedTime);
    setText(row.getCell(4), item.type);
    setText(row.getCell(5), item.category);
    setText(row.getCell(6), item.subcategory);
    setText(row.getCell(7), item.paymentMethod);
    setText(row.getCell(8), item.moneyOrigin);
    row.getCell(9).value = item.amountSoles;
    row.getCell(9).numFmt = MONEY_FORMAT;
    setText(row.getCell(10), item.note);
  }
  sheet.autoFilter = `A1:J${Math.max(2, rows.length + 1)}`;
}

function addSummarySheet(workbook: ExcelJS.Workbook, rows: HistoryExportRow[]): void {
  const summary = summarizeHistoryRows(rows);
  const sheet = workbook.addWorksheet("Resumen");
  sheet.getColumn(1).width = 47;
  sheet.getColumn(2).width = 22;
  sheet.getCell("A1").value = "Resumen del historial";
  sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF065F46" } };
  sheet.getCell("A2").value = "Montos positivos; Ingreso incluye préstamos recibidos.";
  sheet.getCell("A4").value = "Tipo";
  sheet.getCell("B4").value = "Total (S/)";
  styleHeader(sheet, 4, 2);
  const byType: [number, string, number][] = [
    [5, "Ingreso", summary.incomeCents],
    [6, "Egreso", summary.expenseCents],
    [7, "De Ingreso: préstamos recibidos", summary.loanReceiptCents],
  ];
  for (const [number, label, cents] of byType) {
    sheet.getCell(`A${number}`).value = label;
    sheet.getCell(`B${number}`).value = cents / 100;
    sheet.getCell(`B${number}`).numFmt = MONEY_FORMAT;
  }
  sheet.getCell("A9").value = "Categoría de egreso";
  sheet.getCell("B9").value = "Total (S/)";
  styleHeader(sheet, 9, 2);
  const byCategory: [number, string, number][] = [
    [10, "Necesidad", summary.categoryCents.necesidad],
    [11, "Ocio", summary.categoryCents.ocio],
    [12, "Ahorro", summary.categoryCents.ahorro],
  ];
  for (const [number, label, cents] of byCategory) {
    sheet.getCell(`A${number}`).value = label;
    sheet.getCell(`B${number}`).value = cents / 100;
    sheet.getCell(`B${number}`).numFmt = MONEY_FORMAT;
  }
}

export async function buildHistoryXlsx(rows: HistoryExportRow[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  addHistorySheet(workbook, rows);
  addSummarySheet(workbook, rows);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export async function exportHistoryXlsx(
  userId: string, fromMonthId: string, toMonthId: string,
): Promise<Uint8Array> {
  const transactions = await getHistoryTransactions(userId, fromMonthId, toMonthId);
  return buildHistoryXlsx(buildHistoryRows(transactions.map(({ tx }) => tx)));
}

export function downloadXlsx(content: Uint8Array, filename: string): void {
  const blob = new Blob([content as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
