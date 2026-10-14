import type { Report, Rule } from './core.js';
export * from './core.js';
export interface CacheControl { raw: string; maxAge: number | null; sMaxAge: number | null; immutable: boolean; noCache: boolean; noStore: boolean; mustRevalidate: boolean; private: boolean; swr: number | null }
export interface CacheOptions { baseUrl?: string; include?: string[]; exclude?: string[]; cleanUrls?: boolean; expectPrecompressed?: boolean; toolVersion?: string; now?: Date }
export declare const RULES: Record<string, Rule>;
export declare function isHashed(path: string): boolean;
export declare function parseCacheControl(value: string): CacheControl;
export declare function loadExtraRules(dir: string): Array<{ source: string; pattern: string; re: RegExp; headers: Array<[string, string]>; line?: number }>;
export declare function check(dir: string, opts?: CacheOptions, config?: Record<string, unknown>, configFile?: string): Report;
