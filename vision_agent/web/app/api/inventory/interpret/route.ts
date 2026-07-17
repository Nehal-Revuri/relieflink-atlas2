import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getSession } from "../../../../lib/auth";

export async function POST(request: Request) {
  if (!(await getSession()))
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  const { description } = (await request.json()) as { description?: string };
  if (!description?.trim())
    return NextResponse.json(
      { error: "Describe the incoming donation" },
      { status: 400 },
    );

  const fallback = {
    productName: description.trim().slice(0, 200),
    brand: "",
    category: "Needs review",
    quantity: Number(description.match(/\b(\d+(?:\.\d+)?)\b/)?.[1] || 0),
    unit: "items",
    expirationDate: "",
    notes: "Interpreted locally; review category and quantity before approval.",
    mode: "rules",
  };
  if (!process.env.OPENAI_API_KEY) return NextResponse.json(fallback);

  try {
    const response = await new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    }).chat.completions.create({
      model: process.env.OPENAI_TEXT_MODEL || "gpt-5-mini",
      messages: [
        {
          role: "system",
          content:
            "Extract a proposed food-bank inventory row. Never invent a quantity, brand, or expiration. Use an empty string when absent. The operator will review the proposal before it changes inventory.",
        },
        { role: "user", content: description },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "inventory_intake",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              productName: { type: "string" },
              brand: { type: "string" },
              category: { type: "string" },
              quantity: { type: "number" },
              unit: { type: "string" },
              expirationDate: { type: "string" },
              notes: { type: "string" },
            },
            required: [
              "productName",
              "brand",
              "category",
              "quantity",
              "unit",
              "expirationDate",
              "notes",
            ],
          },
        },
      },
    });
    return NextResponse.json({
      ...fallback,
      ...JSON.parse(response.choices[0]?.message.content || "{}"),
      mode: "openai",
    });
  } catch {
    return NextResponse.json(fallback);
  }
}
