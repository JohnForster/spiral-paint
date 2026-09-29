import { elementPolylines } from "../geometry/elements";
import { RegionSet } from "../geometry/regions";
import { LIMITS, line, PRESETS, spiralGroup, validateScene, type Scene, type SceneElement } from "../geometry/scene";
import { LINE_COLOUR, polylineToPath } from "../render/svg";

const PREVIEW_DELAY_MS = 150;
const NS = "http://www.w3.org/2000/svg";

type Mode = "new" | "edit";

interface FieldSpec {
  key: string;
  label: string;
  type: "number" | "select";
  step?: string;
  min?: number;
  max?: number;
  options?: [string, string][];
}

const SPIRAL_FIELDS: FieldSpec[] = [
  { key: "x", label: "Centre x", type: "number", step: "any" },
  { key: "y", label: "Centre y", type: "number", step: "any" },
  { key: "count", label: "Spirals", type: "number", step: "1", min: LIMITS.count.min, max: LIMITS.count.max },
  { key: "growth", label: "Growth rate", type: "number", step: "0.01", min: LIMITS.growth.min, max: LIMITS.growth.max },
  { key: "rotation", label: "Rotation °", type: "number", step: "any" },
  { key: "direction", label: "Direction", type: "select", options: [["alternate", "Alternating"], ["cw", "All clockwise"], ["ccw", "All anticlockwise"]] },
];

const LINE_FIELDS: FieldSpec[] = [
  { key: "x1", label: "From x", type: "number", step: "any" },
  { key: "y1", label: "From y", type: "number", step: "any" },
  { key: "x2", label: "To x", type: "number", step: "any" },
  { key: "y2", label: "To y", type: "number", step: "any" },
  { key: "extent", label: "Type", type: "select", options: [["infinite", "Line (edge to edge)"], ["segment", "Segment"]] },
];

/**
 * The scene editor, used both for a new image and for editing the current one.
 * Resolves with the edited scene, or null if cancelled.
 */
export function openSceneDialog(mode: Mode, initial: Scene, note: string | null): Promise<Scene | null> {
  const dialog = document.getElementById("scene-dialog") as HTMLDialogElement;
  const form = dialog.querySelector("form")!;
  const $ = <T extends Element>(id: string) => document.getElementById(id) as unknown as T;
  const list = $<HTMLUListElement>("scene-elements");
  const fields = $<HTMLFieldSetElement>("scene-element-fields");
  const preview = $<SVGSVGElement>("scene-preview");
  const count = $<HTMLElement>("scene-count");
  const errors = $<HTMLElement>("scene-errors");
  const ok = $<HTMLButtonElement>("scene-ok");
  const presetSelect = $<HTMLSelectElement>("scene-preset");
  const widthInput = form.elements.namedItem("width") as HTMLInputElement;
  const heightInput = form.elements.namedItem("height") as HTMLInputElement;

  $<HTMLElement>("scene-title").textContent = mode === "new" ? "New image" : "Edit scene";
  ok.textContent = mode === "new" ? "Create" : "Apply";
  const noteEl = $<HTMLElement>("scene-note");
  noteEl.hidden = !note;
  noteEl.textContent = note ?? "";

  const scene: Scene = structuredClone(initial);
  let selected = scene.elements.length ? 0 : -1;
  let valid = false;
  let timer = 0;
  widthInput.value = String(scene.width);
  heightInput.value = String(scene.height);
  presetSelect.replaceChildren(...PRESETS.map((p, k) => new Option(p.name, String(k))));

  const describe = (e: SceneElement) =>
    e.kind === "spirals"
      ? `Spirals ×${e.count} at (${fmt(e.x)}, ${fmt(e.y)})`
      : `${e.extent === "segment" ? "Segment" : "Line"} (${fmt(e.x1)}, ${fmt(e.y1)}) → (${fmt(e.x2)}, ${fmt(e.y2)})`;

  const renderList = () => {
    list.replaceChildren(
      ...scene.elements.map((e, k) => {
        const li = document.createElement("li");
        li.textContent = describe(e);
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(k === selected));
        li.addEventListener("click", () => select(k));
        return li;
      }),
    );
  };

  const renderFields = () => {
    const e = scene.elements[selected];
    if (!e) return fields.replaceChildren();
    const legend = document.createElement("legend");
    legend.textContent = e.kind === "spirals" ? "Selected spiral group (click the preview to move it)" : "Selected line";
    const specs = e.kind === "spirals" ? SPIRAL_FIELDS : LINE_FIELDS;
    fields.replaceChildren(
      legend,
      ...specs.map((spec) => {
        const label = document.createElement("label");
        label.append(spec.label + " ");
        const value = String((e as unknown as Record<string, unknown>)[spec.key]);
        let input: HTMLInputElement | HTMLSelectElement;
        if (spec.type === "select") {
          input = document.createElement("select");
          input.append(...spec.options!.map(([v, text]) => new Option(text, v)));
        } else {
          input = Object.assign(document.createElement("input"), { type: "number", step: spec.step ?? "any" });
          if (spec.min !== undefined) input.min = String(spec.min);
          if (spec.max !== undefined) input.max = String(spec.max);
        }
        input.name = `el-${spec.key}`;
        input.value = value;
        input.addEventListener("input", () => {
          (e as unknown as Record<string, unknown>)[spec.key] = spec.type === "number" ? Number(input.value) : input.value;
          renderList();
          schedule();
        });
        label.append(input);
        return label;
      }),
    );
  };

  const select = (k: number) => {
    selected = k;
    renderList();
    renderFields();
    renderPreview();
  };

  const update = () => {
    scene.width = Number(widthInput.value);
    scene.height = Number(heightInput.value);
    const problems = validateScene(scene);
    if (problems.length === 0) {
      const t = performance.now();
      const regions = new RegionSet(scene);
      const ms = performance.now() - t;
      const n = regions.regions.length;
      count.textContent = `${n.toLocaleString()} regions · built in ${Math.round(ms)} ms`;
      if (n > LIMITS.maxRegions)
        problems.push(`That's too many regions (the limit is ${LIMITS.maxRegions.toLocaleString()}). Try fewer spirals or larger growth rates.`);
    } else count.textContent = "";
    errors.textContent = problems.join(" ");
    valid = problems.length === 0;
    ok.disabled = !valid;
    renderPreview();
  };

  const renderPreview = () => {
    const W = scene.width;
    const H = scene.height;
    if (!(W > 0 && H > 0)) return preview.replaceChildren();
    const m = Math.max(W, H) * 0.04;
    preview.setAttribute("viewBox", `${-m} ${-m} ${W + 2 * m} ${H + 2 * m}`);
    const parts: string[] = [
      `<defs><clipPath id="scene-preview-clip"><rect width="${W}" height="${H}"/></clipPath></defs>`,
      `<rect width="${W}" height="${H}" fill="#fff"/>`,
      `<g clip-path="url(#scene-preview-clip)" fill="none" stroke="${LINE_COLOUR}" stroke-width="1">`,
    ];
    scene.elements.forEach((e, k) => {
      const cls = k === selected ? ` class="selected"` : "";
      for (const pl of safePolylines(e, W, H)) parts.push(`<path${cls} d="${polylineToPath(pl)}"/>`);
    });
    parts.push("</g>");
    const markR = Math.max(W, H) / 120;
    scene.elements.forEach((e, k) => {
      if (e.kind === "spirals" && k === selected) parts.push(`<circle class="centre-mark" cx="${e.x}" cy="${e.y}" r="${markR}"/>`);
    });
    const tmp = document.createElementNS(NS, "g");
    tmp.innerHTML = parts.join("");
    preview.replaceChildren(...tmp.childNodes);
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(update, PREVIEW_DELAY_MS);
  };

  const onElementButton = (ev: Event) => {
    const action = (ev.currentTarget as HTMLElement).dataset.scene;
    const W = scene.width || 1200;
    const H = scene.height || 800;
    const cur = scene.elements[selected];
    if (action === "add-spirals") {
      const base = [...scene.elements].reverse().find((e) => e.kind === "spirals");
      scene.elements.push(base && base.kind === "spirals" ? { ...base, x: W / 2, y: H / 2 } : spiralGroup(W / 2, H / 2));
    } else if (action === "add-line") scene.elements.push(line(0, H / 2, W, H / 2));
    else if (action === "duplicate" && cur) scene.elements.push(structuredClone(cur));
    else if (action === "remove" && cur) scene.elements.splice(selected, 1);
    else return;
    select(action === "remove" ? Math.min(selected, scene.elements.length - 1) : scene.elements.length - 1);
    schedule();
  };
  const elementButtons = [...form.querySelectorAll<HTMLButtonElement>("[data-scene]")];
  for (const b of elementButtons) b.addEventListener("click", onElementButton);

  const onPreset = () => {
    const p = PRESETS[Number(presetSelect.value)];
    if (!p) return;
    scene.elements = p.make(Number(widthInput.value) || 1200, Number(heightInput.value) || 800);
    select(0);
    schedule();
  };
  const presetButton = $<HTMLButtonElement>("scene-apply-preset");
  presetButton.addEventListener("click", onPreset);

  const onPreviewClick = (ev: MouseEvent) => {
    const e = scene.elements[selected];
    if (!e || e.kind !== "spirals") return;
    const ctm = preview.getScreenCTM();
    if (!ctm) return;
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
    e.x = Math.round(p.x);
    e.y = Math.round(p.y);
    renderFields();
    renderList();
    schedule();
  };
  preview.addEventListener("click", onPreviewClick);
  form.addEventListener("input", schedule);
  // Enter in a field would implicitly submit the form (closing the dialog);
  // only the Create/Apply and Cancel buttons should close it.
  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === "Enter" && (ev.target as Element).matches("input, select")) ev.preventDefault();
  };
  form.addEventListener("keydown", onKeyDown);

  renderList();
  renderFields();
  update();

  return new Promise((resolve) => {
    const onClose = () => {
      // "close" is dispatched asynchronously, so a previous session's close event
      // can arrive after this session has reopened the dialog; ignore it.
      if (dialog.open) return;
      dialog.removeEventListener("close", onClose);
      clearTimeout(timer);
      form.removeEventListener("input", schedule);
      form.removeEventListener("keydown", onKeyDown);
      preview.removeEventListener("click", onPreviewClick);
      presetButton.removeEventListener("click", onPreset);
      for (const b of elementButtons) b.removeEventListener("click", onElementButton);
      if (dialog.returnValue !== "ok") return resolve(null);
      update();
      resolve(valid ? scene : null);
    };
    dialog.addEventListener("close", onClose);
    dialog.returnValue = "";
    dialog.showModal();
  });
}

/** Polylines for the preview, tolerating half-typed values. */
function safePolylines(e: SceneElement, W: number, H: number) {
  try {
    return validateScene({ width: W, height: H, elements: [e] }).length ? [] : elementPolylines(e, W, H);
  } catch {
    return [];
  }
}

const fmt = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 10) / 10) : "?");
