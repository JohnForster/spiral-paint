import { LIMITS, validateConfig, type SpiralConfig } from "../geometry/config";
import { RegionSet } from "../geometry/regions";
import { LINE_COLOUR, polylineToPath } from "../render/svg";

const PREVIEW_DELAY_MS = 150;

/**
 * Shows the New Image dialog with a live preview and region count.
 * Resolves with the chosen config, or null if cancelled.
 */
export function openNewImageDialog(initial: SpiralConfig, hasUnsavedChanges: boolean): Promise<SpiralConfig | null> {
  const dialog = document.getElementById("new-dialog") as HTMLDialogElement;
  const form = dialog.querySelector("form")!;
  const preview = document.getElementById("new-preview") as unknown as SVGSVGElement;
  const count = document.getElementById("new-count")!;
  const errors = document.getElementById("new-errors")!;
  const hint = document.getElementById("new-hint")!;
  const create = document.getElementById("new-create") as HTMLButtonElement;
  document.getElementById("new-dirty")!.hidden = !hasUnsavedChanges;

  const field = (name: keyof SpiralConfig) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
  for (const [k, v] of Object.entries(initial)) field(k as keyof SpiralConfig).value = String(v);

  const read = (): SpiralConfig => ({
    width: Number(field("width").value),
    height: Number(field("height").value),
    spiralCount: Number(field("spiralCount").value),
    startRadius: Number(field("startRadius").value),
    growthRate: Number(field("growthRate").value),
    centreModel: field("centreModel").value as SpiralConfig["centreModel"],
  });

  let timer = 0;
  let valid = false;
  const update = () => {
    const config = read();
    hint.textContent =
      config.centreModel === "origin"
        ? "Spirals run into the centre; cells too small to see are merged into one centre region. Start radius only rotates the pattern."
        : "Spirals start at the start radius; the area inside is one centre region.";
    const problems = validateConfig(config);
    if (problems.length === 0) {
      const regions = new RegionSet(config);
      const n = regions.regions.length;
      count.textContent = `${n.toLocaleString()} regions`;
      if (n > LIMITS.maxRegions) problems.push(`That's too many regions (the limit is ${LIMITS.maxRegions.toLocaleString()}). Try a larger growth rate or start radius.`);
      renderPreview(preview, regions);
    } else {
      count.textContent = "";
      preview.replaceChildren();
    }
    errors.textContent = problems.join(" ");
    valid = problems.length === 0;
    create.disabled = !valid;
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(update, PREVIEW_DELAY_MS);
  };
  form.addEventListener("input", schedule);
  update();

  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        clearTimeout(timer);
        form.removeEventListener("input", schedule);
        update();
        resolve(dialog.returnValue === "create" && valid ? read() : null);
      },
      { once: true },
    );
    dialog.returnValue = "";
    dialog.showModal();
  });
}

function renderPreview(svg: SVGSVGElement, regions: RegionSet): void {
  const { width: W, height: H } = regions.config;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const NS = "http://www.w3.org/2000/svg";
  const clipId = "preview-clip";
  const parts = [
    `<defs><clipPath id="${clipId}"><rect width="${W}" height="${H}"/></clipPath></defs>`,
    `<rect width="${W}" height="${H}" fill="#fff"/>`,
    `<g clip-path="url(#${clipId})" fill="none" stroke="${LINE_COLOUR}" stroke-width="1">`,
    ...regions.spiralPolylines().map((l) => `<path d="${polylineToPath(l)}"/>`),
    `</g>`,
  ];
  // Parse via a temporary element so the markup lands in the SVG namespace.
  const tmp = document.createElementNS(NS, "g");
  tmp.innerHTML = parts.join("");
  svg.replaceChildren(...tmp.childNodes);
}
