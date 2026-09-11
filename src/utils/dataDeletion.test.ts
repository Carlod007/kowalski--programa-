import { describe, expect, it } from "vitest";
import {
  chunkForDeletion,
  GLOBAL_USER_DATA_COLLECTIONS,
  USER_FINANCIAL_DATA_TREE,
  USER_FLAT_DATA_COLLECTIONS,
} from "./dataDeletion";

describe("plan de eliminación de datos", () => {
  it("incluye todas las colecciones financieras actuales", () => {
    expect(USER_FINANCIAL_DATA_TREE).toEqual([
      {
        collection: "months",
        children: ["transactions", "movements"],
        stage: "Eliminando meses y movimientos…",
      },
      {
        collection: "loans",
        children: ["payments", "fundMovements"],
        stage: "Eliminando préstamos…",
      },
      {
        collection: "creditCards",
        children: ["statements", "payments"],
        stage: "Eliminando tarjetas…",
      },
    ]);
    expect(USER_FLAT_DATA_COLLECTIONS).toEqual([
      {
        collection: "goalAllocations",
        stage: "Eliminando metas e historial…",
      },
    ]);
    expect(GLOBAL_USER_DATA_COLLECTIONS).toEqual([
      {
        collection: "migrationBackups",
        ownerField: "uid",
        stage: "Eliminando respaldos anteriores…",
      },
    ]);
  });

  it("divide grandes cantidades sin superar 500 operaciones", () => {
    const documents = Array.from({ length: 1_201 }, (_, index) => index);
    const chunks = chunkForDeletion(documents);

    expect(chunks.map((chunk) => chunk.length)).toEqual([400, 400, 400, 1]);
    expect(chunks.flat()).toEqual(documents);
  });

  it("rechaza tamaños de lote inválidos", () => {
    expect(() => chunkForDeletion([1], 0)).toThrow();
    expect(() => chunkForDeletion([1], 501)).toThrow();
  });
});
