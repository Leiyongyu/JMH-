import { useEffect, useState } from 'react';
import { api } from '../api/client';

export interface CartItem {
  sku: string;
  title?: string | null;
  qty: number;
  unitPrice: string;
  currency: string;
  itemUrl?: string | null;
}

const STORAGE_KEY = 'ds.cart.v1';
const EVENT_KEY = 'ds:cart:change';

async function fetchFromServer(): Promise<CartItem[] | null> {
  try {
    const resp = await api.get<CartItem[]>('/cart');
    return Array.isArray(resp.data) ? resp.data : [];
  } catch {
    return null;
  }
}

async function pushAddToServer(sku: string, qty: number) {
  try {
    await api.post('/cart/items', { sku, qty });
  } catch {
    // ignore
  }
}

async function pushSetQtyToServer(sku: string, qty: number) {
  try {
    await api.patch(`/cart/items/${encodeURIComponent(sku)}`, { qty });
  } catch {
    // ignore
  }
}

async function pushRemoveToServer(sku: string) {
  try {
    await api.delete(`/cart/items/${encodeURIComponent(sku)}`);
  } catch {
    // ignore
  }
}

async function pushClearToServer() {
  try {
    await api.delete('/cart');
  } catch {
    // ignore
  }
}

function read(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CartItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(items: CartItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(EVENT_KEY));
}

export const cart = {
  getAll: read,
  count(): number {
    return read().reduce((sum, it) => sum + it.qty, 0);
  },
  add(item: Omit<CartItem, 'qty'> & { qty?: number }) {
    const items = read();
    const existing = items.find((it) => it.sku === item.sku);
    const qty = item.qty ?? 1;
    if (existing) existing.qty += qty;
    else items.push({ ...item, qty });
    write(items);
    void pushAddToServer(item.sku, qty).then(async () => {
      const server = await fetchFromServer();
      if (server) write(server);
    });
  },
  setQty(sku: string, qty: number) {
    const items = read().map((it) => (it.sku === sku ? { ...it, qty: Math.max(1, qty) } : it));
    write(items);
    void pushSetQtyToServer(sku, Math.max(1, qty)).then(async () => {
      const server = await fetchFromServer();
      if (server) write(server);
    });
  },
  remove(sku: string) {
    write(read().filter((it) => it.sku !== sku));
    void pushRemoveToServer(sku).then(async () => {
      const server = await fetchFromServer();
      if (server) write(server);
    });
  },
  clear() {
    write([]);
    void pushClearToServer().then(async () => {
      const server = await fetchFromServer();
      if (server) write(server);
    });
  },
  async syncFromServer() {
    const server = await fetchFromServer();
    if (server) write(server);
  },
};

export function useCart(): CartItem[] {
  const [items, setItems] = useState<CartItem[]>(read);
  useEffect(() => {
    const handler = () => setItems(read());
    window.addEventListener(EVENT_KEY, handler);
    window.addEventListener('storage', handler);
    void cart.syncFromServer();
    return () => {
      window.removeEventListener(EVENT_KEY, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);
  return items;
}
