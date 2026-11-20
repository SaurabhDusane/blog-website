export async function copyText(value: string, fallback: HTMLDialogElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const field = fallback?.querySelector('textarea');
    if (!fallback || !field) return false;

    field.value = value;
    if (!fallback.open) fallback.showModal();
    field.select();
    return false;
  }
}
