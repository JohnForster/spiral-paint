/** Offers a blob to the user as a download. */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens the hidden file input and resolves with the chosen file's name and text, or null. */
export function pickTextFile(input: HTMLInputElement): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    input.value = "";
    input.addEventListener(
      "change",
      async () => {
        const file = input.files?.[0];
        resolve(file ? { name: file.name, text: await file.text() } : null);
      },
      { once: true },
    );
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}
