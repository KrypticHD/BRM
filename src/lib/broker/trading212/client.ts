import "server-only";
import type { z } from "zod";
import {
  T212AccountCashSchema,
  T212AccountInfoSchema,
  T212DividendSchema,
  T212OrderSchema,
  T212PositionSchema,
  T212TransactionSchema,
  paginatedSchema,
  type T212AccountCash,
  type T212AccountInfo,
  type T212Dividend,
  type T212Order,
  type T212Position,
  type T212Transaction,
} from "./types";

const BASE_URLS = {
  live: "https://live.trading212.com",
  demo: "https://demo.trading212.com",
} as const;

export type Trading212Environment = keyof typeof BASE_URLS;

/**
 * Trading 212 credentials are a key pair (API Key ID + Secret Key). We
 * store them as a single "keyId:secret" string in Vault so no schema
 * change is needed — encode/decode here keeps that detail contained to
 * this module.
 */
export function encodeTrading212Credential(apiKeyId: string, secretKey: string): string {
  return `${apiKeyId}:${secretKey}`;
}

export function decodeTrading212Credential(
  credential: string,
): { apiKeyId: string; secretKey: string } {
  const separatorIndex = credential.indexOf(":");
  if (separatorIndex === -1) {
    throw new Error("Malformed Trading 212 credential — expected 'apiKeyId:secretKey'.");
  }
  return {
    apiKeyId: credential.slice(0, separatorIndex),
    secretKey: credential.slice(separatorIndex + 1),
  };
}

export class Trading212ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "Trading212ApiError";
  }
}

interface RateLimitState {
  remaining: number;
  resetAtMs: number;
}

const RATE_LIMIT_BACKOFF_MS = 5000;
/** Fallback gap before a bucket's first request, when no header state exists yet. */
const DEFAULT_MIN_INTERVAL_MS = 500;

export class Trading212Client {
  private readonly baseUrl: string;
  /** Auth is a key pair: Basic base64(apiKeyId:secretKey), not a single bearer token. */
  private readonly authHeader: string;
  private readonly rateLimitState = new Map<string, RateLimitState>();

  constructor(
    apiKeyId: string,
    secretKey: string,
    environment: Trading212Environment = "live",
  ) {
    this.baseUrl = BASE_URLS[environment];
    this.authHeader = `Basic ${Buffer.from(`${apiKeyId}:${secretKey}`).toString("base64")}`;
  }

  /** Rate limits are per-endpoint (confirmed via response headers: account/info
   * allows 1/30s, account/cash 1/2s, portfolio 1/5s, history endpoints 6/60s).
   * Bucket key is the URL pathname, so paginated follow-up requests (which hit
   * the same endpoint via a different nextPagePath) share the same bucket. */
  private bucketKeyFor(url: string): string {
    return new URL(url, this.baseUrl).pathname;
  }

  private async waitForBucket(bucketKey: string) {
    const state = this.rateLimitState.get(bucketKey);
    if (!state) {
      await new Promise((resolve) => setTimeout(resolve, DEFAULT_MIN_INTERVAL_MS));
      return;
    }
    if (state.remaining <= 0) {
      const waitMs = state.resetAtMs - Date.now();
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  private recordRateLimitHeaders(bucketKey: string, headers: Headers) {
    const remaining = headers.get("x-ratelimit-remaining");
    const reset = headers.get("x-ratelimit-reset");
    if (remaining === null || reset === null) return;
    this.rateLimitState.set(bucketKey, {
      remaining: Number(remaining),
      // x-ratelimit-reset is a unix timestamp in seconds.
      resetAtMs: Number(reset) * 1000,
    });
  }

  private async request(
    pathOrFullPath: string,
    params?: URLSearchParams,
    isRetry = false,
  ): Promise<unknown> {
    const url = pathOrFullPath.startsWith("http")
      ? pathOrFullPath
      : `${this.baseUrl}${pathOrFullPath}${params ? `?${params.toString()}` : ""}`;

    const bucketKey = this.bucketKeyFor(url);
    await this.waitForBucket(bucketKey);

    const response = await fetch(url, {
      headers: { Authorization: this.authHeader },
    });

    this.recordRateLimitHeaders(bucketKey, response.headers);

    if (response.status === 429 && !isRetry) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_BACKOFF_MS));
      return this.request(pathOrFullPath, params, true);
    }

    if (response.status === 401 || response.status === 403) {
      throw new Trading212ApiError(
        "Trading 212 rejected the API key (unauthorized).",
        response.status,
      );
    }

    if (!response.ok) {
      throw new Trading212ApiError(
        `Trading 212 API request failed: ${response.status} ${response.statusText}`,
        response.status,
      );
    }

    return response.json();
  }

  private async *paginate<T>(
    path: string,
    itemSchema: z.ZodType<T>,
    extraParams: URLSearchParams = new URLSearchParams(),
  ): AsyncGenerator<T> {
    const responseSchema = paginatedSchema(itemSchema);
    let nextPagePath: string | null = null;

    do {
      let data: unknown;
      if (nextPagePath) {
        data = await this.request(nextPagePath);
      } else {
        const params = new URLSearchParams(extraParams);
        params.set("limit", "50");
        data = await this.request(path, params);
      }

      const validated = responseSchema.parse(data);
      for (const item of validated.items) {
        yield item;
      }

      nextPagePath =
        validated.nextPagePath && !validated.nextPagePath.includes("null")
          ? validated.nextPagePath
          : null;
    } while (nextPagePath);
  }

  async getAccountCash(): Promise<T212AccountCash> {
    return T212AccountCashSchema.parse(
      await this.request("/api/v0/equity/account/cash"),
    );
  }

  async getAccountInfo(): Promise<T212AccountInfo> {
    return T212AccountInfoSchema.parse(
      await this.request("/api/v0/equity/account/info"),
    );
  }

  async getPositions(): Promise<T212Position[]> {
    const data = await this.request("/api/v0/equity/portfolio");
    return T212PositionSchema.array().parse(data);
  }

  getOrders(): AsyncGenerator<T212Order> {
    return this.paginate("/api/v0/equity/history/orders", T212OrderSchema);
  }

  getDividends(): AsyncGenerator<T212Dividend> {
    return this.paginate("/api/v0/history/dividends", T212DividendSchema);
  }

  getTransactions(): AsyncGenerator<T212Transaction> {
    return this.paginate("/api/v0/history/transactions", T212TransactionSchema);
  }
}
