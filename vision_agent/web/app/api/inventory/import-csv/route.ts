import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSession } from "../../../../lib/auth";
import { foodBankContext, canEditInventory } from "../../../../lib/food-bank";
import { withTransaction } from "../../../../lib/db";

function parseLine(line: string) {
  const out: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    if (character === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      out.push(value.trim());
      value = "";
    } else value += character;
  }
  out.push(value.trim());
  return out;
}

const key = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_");
const aliases: Record<string, string> = {
  item: "product_name",
  item_name: "product_name",
  name: "product_name",
  product: "product_name",
  product_name: "product_name",
  food: "product_name",
  food_item: "product_name",
  type: "category",
  food_category: "category",
  group: "category",
  count: "quantity",
  qty: "quantity",
  amount: "quantity",
  units: "unit",
  package: "unit",
  package_type: "unit",
  expiry: "expiration_date",
  expiration: "expiration_date",
  expiration_date: "expiration_date",
  best_by: "expiration_date",
  best_by_date: "expiration_date",
  location: "bin_location",
  shelf: "bin_location",
  bin: "bin_location",
};
const mappedKey = (value: string) => aliases[key(value)] || key(value);
type Row = Record<string, string | number> & {
  product_name: string;
  category: string;
  quantity: number;
  unit: string;
};

export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  try {
    const context = await foodBankContext(session);
    if (!canEditInventory(context.role))
      throw new Error("Inventory import permission required");
    const file = (await request.formData()).get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".csv"))
      throw new Error("Choose a CSV file");
    if (file.size > 3_000_000) throw new Error("CSV must be smaller than 3 MB");
    const lines = (await file.text()).split(/\r?\n/).filter(Boolean);
    if (lines.length < 2)
      throw new Error("CSV needs a header and at least one item");
    const rawHeaders = parseLine(lines[0]).map(key);
    const headers = parseLine(lines[0]).map(mappedKey);
    const legacy = rawHeaders.includes("count") && rawHeaders.includes("site");
    const warnings: Array<{ row: number; missing: string[] }> = [];
    const records: Row[] = lines.slice(1).map((line, index) => {
      const values = parseLine(line);
      const row = Object.fromEntries(
        headers.map((header, position) => [header, values[position] ?? ""]),
      ) as Record<string, string>;
      const rawQuantity = row.quantity;
      const parsedQuantity = Number(rawQuantity);
      const quantity =
        rawQuantity !== "" &&
        Number.isFinite(parsedQuantity) &&
        parsedQuantity >= 0
          ? parsedQuantity
          : 0;
      const productName = legacy
        ? row.product_name || row.category.replaceAll("_", " ")
        : row.product_name;
      const missing = [
        !productName && "product_name",
        !row.category && "category",
        (rawQuantity === "" ||
          !Number.isFinite(parsedQuantity) ||
          parsedQuantity < 0) &&
          "quantity",
        !row.unit && "unit",
      ].filter(Boolean) as string[];
      if (missing.length) warnings.push({ row: index + 2, missing });
      const existingNotes = row.notes?.trim();
      const reviewNote = missing.length
        ? `Needs review: missing or invalid ${missing.join(", ")}.`
        : "";
      return {
        ...row,
        product_name: productName || `Unidentified item (row ${index + 2})`,
        category: row.category || "Needs review",
        quantity,
        unit: legacy ? row.unit || "items" : row.unit || "items",
        source_name: legacy ? row.source_name || row.site : row.source_name,
        expiration_date:
          row.expiration_date && /^\d{4}-\d{2}-\d{2}$/.test(row.expiration_date)
            ? row.expiration_date
            : "",
        condition: ["good", "damaged", "quarantined", "expired"].includes(
          row.condition,
        )
          ? row.condition
          : "good",
        notes: [existingNotes, reviewNote].filter(Boolean).join(" "),
      } as Row;
    });
    const items = await withTransaction(async (client) => {
      const added = [];
      for (const row of records) {
        const created = (
          await client.query(
            `INSERT INTO inventory_items(organization_id,site_id,product_name,brand,category,subcategory,quantity,unit,lot_number,expiration_date,warehouse_zone,bin_location,condition,source_name,barcode,notes,intake_method,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'csv',$17,$17) RETURNING *`,
            [
              context.organizationId,
              context.siteId,
              row.product_name,
              row.brand || null,
              row.category,
              row.subcategory || null,
              row.quantity,
              row.unit,
              row.lot_number || null,
              row.expiration_date || null,
              row.warehouse_zone || null,
              row.bin_location || null,
              row.condition || "good",
              row.source_name || null,
              null,
              row.notes || null,
              session.userId,
            ],
          )
        ).rows[0];
        added.push(created);
        if (row.quantity > 0)
          await client.query(
            "INSERT INTO inventory_transactions(organization_id,site_id,inventory_item_id,category,product_name,quantity,unit,direction,transaction_type,source,operator_id,approval_status,reviewer_id,approved_at,idempotency_key,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,'in','intake','csv',$8,'approved',$8,now(),$9,$10)",
            [
              context.organizationId,
              context.siteId,
              created.id,
              row.category,
              row.product_name,
              row.quantity,
              row.unit,
              session.userId,
              `csv-intake:${created.id}:${randomUUID()}`,
              { fileImport: true },
            ],
          );
      }
      return added;
    });
    return NextResponse.json({
      imported: items.length,
      items,
      format: legacy ? "legacy_site_category_count" : "inventory_template",
      warnings,
      message: warnings.length
        ? `${items.length} rows imported. ${warnings.length} row${warnings.length === 1 ? "" : "s"} need missing information.`
        : `${items.length} rows imported successfully.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "CSV import failed" },
      { status: 400 },
    );
  }
}
