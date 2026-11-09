/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {dataRead, dataWrite, serveData, acceptPublish} from "../lib/data-store.mjs";

interface Env {
  ASSETS: {fetch(request: Request): Promise<Response>};
  // The Site's R2 bucket: all published data (lib/data-store.mjs), outside the deployment package.
  DATA_CACHE?: {
    get(key: string): Promise<{body: ReadableStream; size: number; httpEtag?: string} | null>;
    head(key: string): Promise<{customMetadata?: Record<string, string>} | null>;
    put(key: string, value: ArrayBuffer, options?: Record<string, unknown>): Promise<unknown>;
  };
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    // Published data (assets/data/<folder>/<file>): from R2, which holds what this PC published; signed uploads.
    const data = dataRead(url.pathname);
    if (data && (request.method === "GET" || request.method === "HEAD")) return serveData(request, env, data);
    const publish = dataWrite(url.pathname);
    if (publish) return acceptPublish(request, env, publish);

    // App paths such as /apex/cars/corners have no file of their own: serve
    // the one page, which reads its state from the path and query.
    if (url.pathname.startsWith("/apex/") && !/\.[a-z0-9]+$/i.test(url.pathname)) {
      // Ask for the directory form: Cloudflare canonicalizes index.html with
      // a redirect, which would discard the public deep link and its query.
      return env.ASSETS.fetch(new Request(new URL("/apex/", request.url), request));
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
