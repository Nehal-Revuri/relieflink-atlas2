"use client";

import { useState } from "react";

type Draft = {
  productName: string;
  brand: string;
  category: string;
  quantity: number;
  unit: string;
  expirationDate: string;
  warehouseZone: string;
  binLocation: string;
  notes: string;
};
const blank: Draft = {
  productName: "",
  brand: "",
  category: "",
  quantity: 0,
  unit: "items",
  expirationDate: "",
  warehouseZone: "",
  binLocation: "",
  notes: "",
};

export function ManualIntake({ onAdded }: { onAdded: () => void }) {
  const [description, setDescription] = useState(""),
    [draft, setDraft] = useState<Draft>(blank),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function interpret() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/inventory/interpret", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description }),
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not create draft");
      setDraft((current) => ({ ...current, ...body }));
      setMessage(
        "Draft created. Confirm every field before adding it to inventory.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not create draft",
      );
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    if (!draft.productName || !draft.category || !draft.unit) {
      setMessage("Food item, category, and unit are required.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/inventory/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...draft,
            condition: "good",
            intakeMethod: "manual",
          }),
        }),
        body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Could not add inventory");
      setDraft(blank);
      setDescription("");
      setMessage("Added to the shared ledger and audit log.");
      onAdded();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not add inventory",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="manual-intake">
      <div className="intake-description">
        <p className="eyebrow">Fast manual entry</p>
        <h3>Describe the incoming inventory</h3>
        <p>
          Example: “24 cases of canned corn, Green Farm, best by June 2027.” The
          rules fallback still works if OpenAI is unavailable.
        </p>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Describe the item, quantity, unit, and any known dates"
        />
        <button
          className="button secondary"
          disabled={busy || !description.trim()}
          onClick={() => void interpret()}
        >
          Create editable draft
        </button>
      </div>
      <div className="intake-draft">
        <div className="review-grid">
          <label>
            Food item
            <input
              value={draft.productName}
              onChange={(e) =>
                setDraft({ ...draft, productName: e.target.value })
              }
            />
          </label>
          <label>
            Brand
            <input
              value={draft.brand}
              onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
            />
          </label>
          <label>
            Category
            <input
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            />
          </label>
          <label>
            Quantity
            <input
              type="number"
              min="0"
              value={draft.quantity}
              onChange={(e) =>
                setDraft({ ...draft, quantity: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Unit
            <input
              value={draft.unit}
              onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
            />
          </label>
          <label>
            Expiration
            <input
              type="date"
              value={draft.expirationDate}
              onChange={(e) =>
                setDraft({ ...draft, expirationDate: e.target.value })
              }
            />
          </label>
          <label>
            Warehouse zone
            <input
              value={draft.warehouseZone}
              onChange={(e) =>
                setDraft({ ...draft, warehouseZone: e.target.value })
              }
            />
          </label>
          <label>
            Bin location
            <input
              value={draft.binLocation}
              onChange={(e) =>
                setDraft({ ...draft, binLocation: e.target.value })
              }
            />
          </label>
        </div>
        <label className="notes-field">
          Notes
          <textarea
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </label>
        {message && <p className="notice-inline">{message}</p>}
        <button
          className="button primary full"
          disabled={busy}
          onClick={() => void approve()}
        >
          Approve inventory entry
        </button>
      </div>
    </section>
  );
}
