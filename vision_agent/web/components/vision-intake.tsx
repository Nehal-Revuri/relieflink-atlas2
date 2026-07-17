"use client";

import { useEffect, useRef, useState } from "react";
import type { VisionResult } from "../lib/vision";

type Draft = {
  productName: string;
  brand: string;
  category: string;
  quantity: number;
  unit: string;
  lotNumber: string;
  expirationDate: string;
  warehouseZone: string;
  binLocation: string;
  barcode: string;
  notes: string;
};

const emptyDraft: Draft = {
  productName: "",
  brand: "",
  category: "",
  quantity: 0,
  unit: "items",
  lotNumber: "",
  expirationDate: "",
  warehouseZone: "",
  binLocation: "",
  barcode: "",
  notes: "",
};

type Detector = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
};
type DetectorConstructor = new (options?: { formats?: string[] }) => Detector;

export function VisionIntake({ onAdded }: { onAdded: () => void }) {
  const [mode, setMode] = useState<"photo" | "describe" | "barcode">("photo");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }
  useEffect(() => () => stopCamera(), []);
  useEffect(() => {
    if (cameraOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play();
    }
  }, [cameraOpen]);

  async function openCamera() {
    setError("");
    try {
      stopCamera();
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
      });
      setCameraOpen(true);
    } catch {
      setError(
        "Camera access failed. Allow camera permission or upload a photo.",
      );
    }
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob)
          setFile(
            new File([blob], "donation-intake.jpg", { type: "image/jpeg" }),
          );
      },
      "image/jpeg",
      0.9,
    );
    stopCamera();
  }

  async function scanBarcode() {
    const video = videoRef.current;
    const BarcodeDetector = (
      window as typeof window & { BarcodeDetector?: DetectorConstructor }
    ).BarcodeDetector;
    if (!BarcodeDetector) {
      setError(
        "Automatic barcode scanning is not available in this browser. Enter the code below.",
      );
      return;
    }
    if (!video?.videoWidth) return;
    try {
      const codes = await new BarcodeDetector().detect(video);
      if (!codes[0]?.rawValue) throw new Error();
      setDraft((current) => ({ ...current, barcode: codes[0].rawValue }));
      setStatus(
        `Barcode ${codes[0].rawValue} captured. Add the item details, then approve.`,
      );
      stopCamera();
    } catch {
      setError(
        "No barcode was detected. Move closer, improve lighting, and try again.",
      );
    }
  }

  async function analyzePhoto() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("image", file);
      const response = await fetch("/api/vision/analyze", {
        method: "POST",
        body: form,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Analysis failed");
      setResult(body);
      setDraft((current) => ({
        ...current,
        productName: body.classification.product,
        category: body.classification.category,
        quantity: body.visibleObjectCount,
        unit: body.classification.packaging || "items",
        notes: `Photo-assisted intake using ${body.yoloModel}; operator review required.`,
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Analysis failed");
    } finally {
      setBusy(false);
    }
  }

  async function interpretDescription() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/inventory/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Could not interpret description");
      setDraft((current) => ({ ...current, ...body }));
      setStatus(
        body.mode === "openai"
          ? "OpenAI prepared a draft. Review every field before approval."
          : "A basic draft was prepared. Add the missing information before approval.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not interpret description",
      );
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!draft.productName || !draft.category || !draft.unit) {
      setError("Food item, category, and unit are required before approval.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/inventory/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          condition: "good",
          intakeMethod: result ? "vision" : "manual",
          visionConfidence: result?.averageConfidence ?? null,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Could not add inventory");
      setStatus("Approved and added to the shared inventory ledger.");
      setDraft(emptyDraft);
      setDescription("");
      setFile(null);
      setResult(null);
      onAdded();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not add inventory",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="intake-workspace">
      <div
        className="intake-methods"
        role="tablist"
        aria-label="Inventory intake method"
      >
        {(
          [
            ["photo", "Photo analysis"],
            ["describe", "Describe donation"],
            ["barcode", "Scan barcode"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className={mode === value ? "active" : ""}
            onClick={() => {
              stopCamera();
              setMode(value);
              setError("");
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="intake-layout">
        <div className="intake-source">
          {mode === "photo" && (
            <>
              <h3>Photograph incoming donations</h3>
              <p>
                Use an aerial photo of boxes or food arranged on an intake
                table.
              </p>
              <input
                id="food-image"
                type="file"
                accept="image/*"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
              <label className="button secondary" htmlFor="food-image">
                {file ? file.name : "Choose photo"}
              </label>
              <button
                className="button secondary"
                onClick={() => void openCamera()}
              >
                Use phone camera
              </button>
              {file && (
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void analyzePhoto()}
                >
                  {busy ? "Analyzing…" : "Analyze photo"}
                </button>
              )}
            </>
          )}
          {mode === "describe" && (
            <>
              <h3>Describe what arrived</h3>
              <p>
                Example: “24 cases of canned corn from Green Farm, best by June
                2027.”
              </p>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Describe the donation in plain language"
              />
              <button
                className="button primary"
                disabled={!description.trim() || busy}
                onClick={() => void interpretDescription()}
              >
                {busy ? "Preparing draft…" : "Create editable draft"}
              </button>
            </>
          )}
          {mode === "barcode" && (
            <>
              <h3>Scan or enter a barcode</h3>
              <p>
                Camera scanning uses the browser Barcode Detector when the
                device supports it.
              </p>
              <button
                className="button secondary"
                onClick={() => void openCamera()}
              >
                Open barcode camera
              </button>
              <label>
                Barcode
                <input
                  value={draft.barcode}
                  onChange={(event) =>
                    setDraft({ ...draft, barcode: event.target.value })
                  }
                  placeholder="UPC, EAN, or internal code"
                />
              </label>
            </>
          )}
          {cameraOpen && (
            <div className="camera-block">
              <video
                ref={videoRef}
                className="camera-preview"
                muted
                playsInline
              />
              <button
                className="button primary"
                onClick={
                  mode === "barcode" ? () => void scanBarcode() : capturePhoto
                }
              >
                {mode === "barcode" ? "Detect barcode" : "Capture photo"}
              </button>
              <button className="button ghost" onClick={stopCamera}>
                Cancel
              </button>
            </div>
          )}
          {error && <p className="error">{error}</p>}
          {status && <p className="success">{status}</p>}
        </div>

        <div className="intake-review">
          <div className="review-heading">
            <div>
              <p className="eyebrow">Human review</p>
              <h3>Inventory transaction draft</h3>
            </div>
            {result && <strong>{result.visibleObjectCount} detected</strong>}
          </div>
          {result && (
            <div className="annotated-image">
              <img
                src={result.imageDataUrl}
                alt="Donation intake with detection overlay"
              />
              {result.detections.map((detection, index) => (
                <span
                  key={index}
                  className="detection-box"
                  style={{
                    left: `${((detection.x - detection.width / 2) / result.imageWidth) * 100}%`,
                    top: `${((detection.y - detection.height / 2) / result.imageHeight) * 100}%`,
                    width: `${(detection.width / result.imageWidth) * 100}%`,
                    height: `${(detection.height / result.imageHeight) * 100}%`,
                  }}
                />
              ))}
            </div>
          )}
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
                onChange={(e) =>
                  setDraft({ ...draft, category: e.target.value })
                }
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
              Lot number
              <input
                value={draft.lotNumber}
                onChange={(e) =>
                  setDraft({ ...draft, lotNumber: e.target.value })
                }
              />
            </label>
            <label>
              Zone
              <input
                value={draft.warehouseZone}
                onChange={(e) =>
                  setDraft({ ...draft, warehouseZone: e.target.value })
                }
              />
            </label>
            <label>
              Bin
              <input
                value={draft.binLocation}
                onChange={(e) =>
                  setDraft({ ...draft, binLocation: e.target.value })
                }
              />
            </label>
            <label>
              Barcode
              <input
                value={draft.barcode}
                onChange={(e) =>
                  setDraft({ ...draft, barcode: e.target.value })
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
          <button
            className="button primary full"
            disabled={busy}
            onClick={() => void approve()}
          >
            Approve and add to inventory
          </button>
          <p className="helper">
            No model or barcode result changes inventory until you approve this
            draft.
          </p>
        </div>
      </div>
    </section>
  );
}
