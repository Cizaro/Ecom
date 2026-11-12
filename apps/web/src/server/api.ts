import "server-only";

import {
  createLogger,
  ForbiddenError,
  hasPermission,
  NotFoundError,
  type CurrentSession,
  type RequestContext,
} from "@ecom/core";
import { getEnv } from "@ecom/config";
import { z } from "zod";
import { getAccessOutcome, getRequestId } from "./access";
import { REQUEST_ID_HEADER } from "./request-id";
import type { RouteAccess } from "./route-access";

// Helpers for /api/v1 routes, implementing docs/API_SPECIFICATION.md:
// one error format, a request ID on every response, one declared access rule
// per route, and strict Zod validation of the query string.

export type ApiErrorCode =
  | "validation_failed"
  | "invalid_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "internal_error";

const STATUS: Record<ApiErrorCode, number> = {
  validation_failed: 400,
  invalid_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal_error: 500,
};

export interface ApiErrorDetail {
  field: string;
  issue: string;
}

/** Throw from a handler to answer with the standard error format. */
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: ApiErrorDetail[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function json(body: unknown, status: number, requestId: string): Response {
  return Response.json(body, {
    status,
    headers: { [REQUEST_ID_HEADER]: requestId, "Cache-Control": "no-store" },
  });
}

export function errorResponse(error: ApiError, requestId: string): Response {
  return json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
        requestId,
      },
    },
    STATUS[error.code],
    requestId,
  );
}

type Authorized<A extends RouteAccess> = A extends { level: "public" }
  ? { session: null; context: null }
  : A extends { level: "session" }
    ? { session: CurrentSession; context: RequestContext | null }
    : { session: CurrentSession; context: RequestContext };

async function authorize(access: RouteAccess) {
  if (access.level === "public") return { session: null, context: null };

  const outcome = await getAccessOutcome();
  if (outcome.status === "unauthenticated") {
    throw new ApiError("unauthenticated", "Sign in to use this endpoint.");
  }
  const context = "context" in outcome ? outcome.context : null;
  if (access.level === "session") return { session: outcome.session, context };

  if (outcome.status === "no_membership" || outcome.status === "choose_tenant") {
    throw new ApiError("forbidden", "Choose a store before using this endpoint.");
  }
  if (outcome.status === "two_factor_required") {
    throw new ApiError("forbidden", "Your store requires two-factor authentication.");
  }
  if (access.level === "permission" && !hasPermission(outcome.context, access.permission)) {
    throw new ApiError("forbidden", "Your role does not allow this.");
  }
  return { session: outcome.session, context: outcome.context };
}

function validationDetails(error: z.ZodError): ApiErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join(".") || "(query)",
    issue: issue.message,
  }));
}

export interface RouteOptions<A extends RouteAccess, Q extends z.ZodType> {
  access: A;
  /** Query-string schema. Unknown parameters are rejected. */
  query?: Q;
}

export type RouteHandler<A extends RouteAccess, Q extends z.ZodType> = (
  args: Authorized<A> & { request: Request; requestId: string; query: z.infer<Q> },
) => Promise<unknown>;

/**
 * Wraps a route handler with authorization, validation and error handling.
 * The handler returns the response body; it is sent as JSON with status 200.
 */
export function apiRoute<A extends RouteAccess, Q extends z.ZodType = z.ZodObject<z.ZodRawShape>>(
  options: RouteOptions<A, Q>,
  handler: RouteHandler<A, Q>,
): (request: Request) => Promise<Response> {
  const querySchema = options.query ?? z.strictObject({});

  return async (request) => {
    const requestId = await getRequestId();
    try {
      const authorized = (await authorize(options.access)) as Authorized<A>;
      const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!parsed.success) {
        throw new ApiError(
          "validation_failed",
          "The request is not valid.",
          validationDetails(parsed.error),
        );
      }
      const body = await handler({
        ...authorized,
        request,
        requestId,
        query: parsed.data as z.infer<Q>,
      });
      return json(body, 200, requestId);
    } catch (error) {
      if (error instanceof ApiError) return errorResponse(error, requestId);
      if (error instanceof NotFoundError) {
        return errorResponse(new ApiError("not_found", "Not found."), requestId);
      }
      if (error instanceof ForbiddenError) {
        return errorResponse(
          new ApiError("forbidden", "Your role does not allow this."),
          requestId,
        );
      }
      createLogger("web", getEnv().LOG_LEVEL).error(
        { requestId, err: (error as Error).message, path: new URL(request.url).pathname },
        "api route failed",
      );
      return errorResponse(new ApiError("internal_error", "Something went wrong."), requestId);
    }
  };
}
