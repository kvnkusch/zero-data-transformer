import type {
  Query,
  Schema,
  SchemaQuery,
  Transaction,
  TypedView,
  ViewFactory,
} from "@rocicorp/zero";
import {
  decodeQueryResult,
  encodeTableRow,
  wrapQueryTree,
} from "./query-builders.ts";
import { wrapFactoryWithDecodedViews } from "./view-decoder.ts";

const wrappedTransactionSymbol = Symbol.for(
  "zero-data-transformer/wrapped-transaction",
);

export function wrapTransactionWithDataTransforms<TTx extends Transaction<any, any>>(
  schema: Schema,
  tx: TTx,
): TTx {
  if (
    typeof tx === "object" &&
    tx !== null &&
    wrappedTransactionSymbol in (tx as unknown as Record<PropertyKey, unknown>)
  ) {
    return tx;
  }

  const wrappedQuery = tx.query
    ? wrapQueryTree(tx.query as Record<string, unknown>, schema, {
        async run(query, options) {
          return decodeQueryResult(schema, query, await tx.run(query as never, options as never));
        },
        materialize(query, factoryOrOptions, options) {
          if (typeof (query as unknown as Record<string, unknown>).materialize === "function") {
            const rawMaterialize = (query as unknown as Record<string, unknown>).materialize as (
              factoryOrOptions?: unknown,
              options?: unknown,
            ) => unknown;
            if (typeof factoryOrOptions === "function") {
              return rawMaterialize(
                wrapFactoryWithDecodedViews(
                  schema,
                  query,
                  factoryOrOptions as ViewFactory<any, Schema, any, unknown>,
                ),
                options,
              );
            }
            return wrapTypedView(
              schema,
              query,
              rawMaterialize(factoryOrOptions, options) as TypedView<unknown>,
            );
          }

          if (typeof factoryOrOptions === "function") {
            throw new Error(
              "Wrapped transaction query does not support custom materialize factory",
            );
          }

          return makeStaticView(tx.run(query as never, factoryOrOptions as never), schema, query);
        },
        preload(query, options) {
          if (typeof (query as unknown as Record<string, unknown>).preload === "function") {
            return (
              (query as unknown as Record<string, unknown>).preload as (
                options?: unknown,
              ) => unknown
            )(options);
          }
          void tx.run(query as never, options as never);
          return { cleanup: () => {}, complete: Promise.resolve() };
        },
      })
    : undefined;

  Object.defineProperty(tx, wrappedTransactionSymbol, {
    value: true,
    configurable: true,
  });

  return new Proxy(tx, {
    get(target, prop) {
      if (prop === wrappedTransactionSymbol) {
        return true;
      }

      if (prop === "mutate") {
        return wrapTransactionMutate(schema, target.mutate as Record<string, unknown>);
      }

      if (prop === "run") {
        return async (query: Query<any, Schema, any>, options?: unknown) =>
          decodeQueryResult(schema, query, await target.run(query, options as never));
      }

      if (prop === "query" && wrappedQuery) {
        return wrappedQuery as SchemaQuery<Schema>;
      }

      return Reflect.get(target, prop, target);
    },
  }) as TTx;
}

function wrapTransactionMutate<S extends Schema>(schema: S, mutate: Record<string, unknown>) {
  return new Proxy(mutate, {
    get(target, prop, receiver) {
      if (typeof prop !== "string") {
        return Reflect.get(target, prop, receiver);
      }

      const tableMutate = Reflect.get(target, prop, receiver);
      if (typeof tableMutate !== "object" || tableMutate === null || !(prop in schema.tables)) {
        return tableMutate;
      }

      return new Proxy(tableMutate as Record<string, unknown>, {
        get(tableTarget, kind, tableReceiver) {
          const method = Reflect.get(tableTarget, kind, tableReceiver);
          if (typeof method !== "function" || typeof kind !== "string") {
            return method;
          }
          if (kind === "delete" || kind === "insert" || kind === "upsert" || kind === "update") {
            return (value: Record<string, unknown>) =>
              (method as (value: Record<string, unknown>) => Promise<void>)(
                encodeTableRow(schema, prop, value),
              );
          }
          return method.bind(tableTarget);
        },
      });
    },
  });
}

function wrapTypedView<S extends Schema>(
  schema: S,
  query: Query<any, S, any>,
  view: TypedView<unknown>,
): TypedView<unknown> {
  return {
    addListener(listener) {
      return view.addListener((data, resultType, error) => {
        listener(decodeQueryResult(schema, query, data), resultType, error);
      });
    },
    destroy() {
      view.destroy();
    },
    updateTTL(ttl) {
      view.updateTTL(ttl);
    },
    get data() {
      return decodeQueryResult(schema, query, view.data);
    },
  };
}

function makeStaticView<S extends Schema>(
  promise: Promise<unknown>,
  schema: S,
  query: Query<any, S, any>,
): TypedView<unknown> {
  let current: unknown;
  const listeners = new Set<any>();
  void promise.then((data) => {
    current = decodeQueryResult(schema, query, data);
    for (const listener of listeners) {
      listener(current, "complete");
    }
  });

  return {
    addListener(listener) {
      listeners.add(listener);
      if (current !== undefined) {
        listener(current as never, "complete");
      }
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {},
    updateTTL() {},
    get data() {
      return current;
    },
  };
}
