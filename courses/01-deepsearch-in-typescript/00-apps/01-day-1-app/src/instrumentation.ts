import { registerOTel } from "@vercel/otel";
import { LangfuseExporter } from "langfuse-vercel";
import { env } from "./env";

export function register() {
    registerOTel({
      serviceName: "ai-hero-project-1",
      traceExporter: new LangfuseExporter({
        environment: env.NODE_ENV,
      }),
    });
  }