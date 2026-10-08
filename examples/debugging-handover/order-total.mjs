// Intentionally buggy fixture for a debugging handover exercise.
export function orderTotal(items) {
  return items.reduce((total, item) => total + item.price * item.quantity, 0);
}
