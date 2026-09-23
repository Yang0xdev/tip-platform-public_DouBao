/**
 * 本机收藏（M1-14）：仅存设备本地，不产生账号画像/顾问归属/佣金。
 * 比较页只读本地快照（id/version 用于检测内容更新）。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ProjectView } from "./api";

const KEY = "tip.favorites.v1";

export interface FavoriteItem {
  id: string;
  code: string;
  version: number;
  title: string;
  savedAt: string;
}

function toFavorite(p: ProjectView): FavoriteItem {
  return { id: p.id, code: p.code, version: p.version, title: p.title, savedAt: new Date().toISOString() };
}

export async function listFavorites(): Promise<FavoriteItem[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as FavoriteItem[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function isFavorite(id: string): Promise<boolean> {
  return (await listFavorites()).some((f) => f.id === id);
}

export async function toggleFavorite(p: ProjectView): Promise<boolean> {
  const items = await listFavorites();
  const idx = items.findIndex((f) => f.id === p.id);
  if (idx >= 0) items.splice(idx, 1);
  else items.unshift(toFavorite(p));
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
  return idx < 0;
}
