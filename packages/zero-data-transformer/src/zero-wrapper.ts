import type {HumanReadable, MaterializeOptions, Query, QueryOrQueryRequest, SchemaQuery, RunOptions, Schema, TypedView, ViewFactory} from "@rocicorp/zero";
import {
  createProxyBuilder,
  decodeQueryResult,
  unwrapProxyQuery,
} from "./query-builders.ts";
import { wrapFactoryWithDecodedViews } from "./view-decoder.ts";

type MinimalZero<S extends Schema, C> = {
  readonly schema: S;
  readonly context: C;
  readonly clientID: string;
  readonly query: SchemaQuery<S>;
  run(
    query: QueryOrQueryRequest<any, any, any, S, any, C>,
    options?: RunOptions,
  ): Promise<HumanReadable<any>>;
  preload(
    query: QueryOrQueryRequest<any, any, any, S, any, C>,
    options?: { ttl?: unknown },
  ): { cleanup: () => void; complete: Promise<void> };
  materialize(
    query: QueryOrQueryRequest<any, any, any, S, any, C>,
    options?: MaterializeOptions,
  ): TypedView<HumanReadable<any>>;
  materialize<T>(
    query: QueryOrQueryRequest<any, any, any, S, any, C>,
    factory: ViewFactory<any, S, any, T>,
    options?: MaterializeOptions,
  ): T;
};

export function createZeroWithDataTransforms<S extends Schema, C, TZero extends MinimalZero<S, C>>(
  zero: TZero,
): TZero {
  const builder = createProxyBuilder(zero.schema);

  return new Proxy(zero, {
    get(target, prop) {
      if (prop === "query") {
        return builder;
      }

      if (prop === "run") {
        return async (...args: unknown[]) => {
          const [query, runOptions] = args as [
            QueryOrQueryRequest<any, any, any, S, any, C>,
            RunOptions | undefined,
          ];
          const resolvedQuery = resolveQuery(query, target.context);
          const result = await target.run(resolvedQuery, runOptions);
          return decodeQueryResult(target.schema, resolvedQuery, result);
        };
      }

      if (prop === "preload") {
        return (...args: unknown[]) => {
          const [query, options] = args as [
            QueryOrQueryRequest<any, any, any, S, any, C>,
            { ttl?: unknown } | undefined,
          ];
          return target.preload(resolveQuery(query, target.context), options);
        };
      }

      if (prop === "materialize") {
        return (...args: unknown[]) => {
          const [rawQuery, second, third] = args;
          const query = rawQuery as QueryOrQueryRequest<any, any, any, S, any, C>;
          const resolvedQuery = resolveQuery(query, target.context);

          if (typeof second === "function") {
              const wrappedFactory = wrapFactoryWithDecodedViews(
                target.schema,
                resolvedQuery,
                second as ViewFactory<any, S, any, unknown>,
            );
            return target.materialize(
              resolvedQuery,
              wrappedFactory,
              third as MaterializeOptions | undefined,
            );
          }

          const view = target.materialize(resolvedQuery, second as MaterializeOptions | undefined);
          return view;
        };
      }

      return Reflect.get(target, prop, target);
    },
  }) as TZero;
}

function resolveQuery<S extends Schema, C>(
  query: QueryOrQueryRequest<any, any, any, S, any, C>,
  context: C,
): Query<any, S, any> {
  if (typeof query === "object" && query !== null && "query" in query) {
    return unwrapProxyQuery(query.query.fn({ args: query.args, ctx: context })) as Query<
      any,
      S,
      any
    >;
  }
  return unwrapProxyQuery(query) as Query<any, S, any>;
}
