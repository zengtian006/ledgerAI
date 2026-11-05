export const CATEGORIES = ['Groceries', 'Dining', 'Transport', 'Utilities', 'Entertainment', 'Shopping', 'Other'];

export const CATEGORY_STYLE = {
  Groceries: { color: '#34c759', icon: '🛒' },
  Dining: { color: '#ff9500', icon: '🍽️' },
  Transport: { color: '#007aff', icon: '🚌' },
  Utilities: { color: '#ffcc00', icon: '💡' },
  Entertainment: { color: '#af52de', icon: '🎬' },
  Shopping: { color: '#ff2d55', icon: '🛍️' },
  Other: { color: '#8e8e93', icon: '🧾' },
};

export function money(amount, currency = 'GBP') {
  try {
    // device locale, so JPY shows as ¥ in Japan
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount ?? 0);
  } catch {
    return `${currency} ${(amount ?? 0).toFixed(2)}`;
  }
}

export const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const todayISO = () => {
  const d = new Date();
  return `${currentMonth()}-${String(d.getDate()).padStart(2, '0')}`;
};

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const monthLabel = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};

export const dayLabel = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};

export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const MAX_EDGE = 1600;

// Downscale + re-encode as JPEG in the browser so uploads are small and fast.
// Falls back to the original file if the browser can't decode it (e.g. HEIC on some browsers).
export async function compressImage(file) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    if (blob && blob.size < file.size) return { blob, name: 'receipt.jpg' };
  } catch {
    // use original
  }
  return { blob: file, name: file.name || 'receipt.jpg' };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 🇬🇧 etc. from an ISO country code
export const flag = (code) =>
  code ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '🌍';
