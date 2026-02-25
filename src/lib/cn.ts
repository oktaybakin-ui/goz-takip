import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tailwind class name merger - duplicate class'ları temizler
 * ve conditional class'ları optimize eder
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}