export function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const value = document.getElementById(id);

  if (!value) throw new Error(`Missing application element: ${id}`);

  return value as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The operation could not be completed.';
}

export function button(
  label: string,
  id: string,
  action?: () => void,
): HTMLButtonElement {
  const result = document.createElement('button');

  result.type = 'button';
  result.className = 'button secondary';
  result.textContent = label;
  result.id = id;

  if (action) result.onclick = action;

  return result;
}

export function setButtonVariant(
  target: HTMLButtonElement,
  variant: 'primary' | 'secondary' | 'ghost' | 'danger',
): void {
  target.classList.remove('primary', 'secondary', 'ghost', 'danger');
  target.classList.add(variant);
}
