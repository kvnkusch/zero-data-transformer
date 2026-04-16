import {
  createBuilder as createCoreBuilder,
  type Condition,
  type Format,
  type Query,
  type ReadonlyJSONValue,
  type Schema,
  type SchemaQuery,
  type SimpleOperator,
} from "@rocicorp/zero";
import { asQueryInternals } from "@rocicorp/zero/bindings";
import { getColumnTransform } from "./column-transforms.ts";

const proxyTargetSymbol = Symbol.for("zero-data-transformer/proxy-target");

type AnyQuery = Query<any, any, any>;
type ExistsOptions = { flip?: boolean; scalar?: boolean };
type QueryRuntime = {
  run?: (query: AnyQuery, options?: unknown) => unknown;
  materialize?: (query: AnyQuery, factoryOrOptions?: unknown, options?: unknown) => unknown;
  preload?: (query: AnyQuery, options?: unknown) => unknown;
};

export function createProxyBuilder<S extends Schema>(schema: S): SchemaQuery<S> {
  return wrapQueryTree(createCoreBuilder(schema) as Record<string, unknown>, schema);
}

export function wrapQueryTree<S extends Schema>(
  queryRoot: Record<string, unknown>,
  schema: S,
  runtime?: QueryRuntime,
): SchemaQuery<S> {
  return new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_target, prop) {
      if (typeof prop !== "string") {
        return undefined;
      }
      const rawQuery = queryRoot[prop] as AnyQuery | undefined;
      return rawQuery ? wrapCoreQuery(rawQuery, schema, runtime) : undefined;
    },
  }) as SchemaQuery<S>;
}

export function isProxyWrappedQuery(value: unknown): value is AnyQuery {
  return typeof value === "object" && value !== null && proxyTargetSymbol in value;
}

export function unwrapProxyQuery<T>(query: T): T {
  if (isProxyWrappedQuery(query)) {
    return (query as Record<PropertyKey, unknown>)[proxyTargetSymbol] as T;
  }
  return query;
}

function wrapCoreQuery<S extends Schema>(
  rawQuery: AnyQuery,
  schema: S,
  runtime?: QueryRuntime,
): AnyQuery {
  const existing = (rawQuery as unknown as Record<PropertyKey, unknown>)[proxyTargetSymbol];
  if (existing) {
    return existing as AnyQuery;
  }

  const proxy = new Proxy(rawQuery as unknown as Record<string, unknown>, {
    get(target, prop) {
      if (prop === proxyTargetSymbol) {
        return rawQuery;
      }

      if (prop === "run" && runtime?.run) {
        const run = runtime.run;
        return (options?: unknown) => run(rawQuery, options);
      }

      if (prop === "materialize" && runtime?.materialize) {
        const materialize = runtime.materialize;
        return (factoryOrOptions?: unknown, options?: unknown) =>
          materialize(rawQuery, factoryOrOptions, options);
      }

      if (prop === "preload" && runtime?.preload) {
        const preload = runtime.preload;
        return (options?: unknown) => preload(rawQuery, options);
      }

      if (prop === "where") {
        return (...args: unknown[]) => {
          const tableName = getQueryTableName(rawQuery);
          if (typeof args[0] === "function") {
            const next = (rawQuery.where as (factory: (eb: unknown) => Condition) => AnyQuery)(
              (rawEb: unknown) =>
                (args[0] as (eb: ReturnType<typeof makeCoreExpressionBuilder>) => Condition)(
                  makeCoreExpressionBuilder(
                    rawEb as Record<string, unknown>,
                    schema,
                    tableName,
                    runtime,
                  ),
                ),
            );
            return wrapCoreQuery(next, schema, runtime);
          }

          const field = args[0] as string;
          if (args.length === 2) {
            return wrapCoreQuery(
              (rawQuery.where as (field: string, value: unknown) => AnyQuery)(
                field,
                encodeFilterValue(schema, tableName, field, "=", args[1]),
              ),
              schema,
              runtime,
            );
          }

          return wrapCoreQuery(
            (rawQuery.where as (field: string, op: SimpleOperator, value: unknown) => AnyQuery)(
              field,
              args[1] as SimpleOperator,
              encodeFilterValue(schema, tableName, field, args[1] as SimpleOperator, args[2]),
            ),
            schema,
            runtime,
          );
        };
      }

      if (prop === "start") {
        return (row: Record<string, unknown>, opts?: { inclusive: boolean }) =>
          wrapCoreQuery(
            (
              rawQuery.start as (
                row: Record<string, ReadonlyJSONValue | undefined>,
                opts?: { inclusive: boolean },
              ) => AnyQuery
            )(encodeRow(schema, getQueryTableName(rawQuery), row), opts),
            schema,
            runtime,
          );
      }

      if (prop === "related") {
        return (relationship: string, cb?: (query: AnyQuery) => AnyQuery) =>
          wrapCoreQuery(
            (
              rawQuery.related as (
                relationship: string,
                cb?: (query: AnyQuery) => AnyQuery,
              ) => AnyQuery
            )(
              relationship,
              cb
                ? (query: AnyQuery) => unwrapProxyQuery(cb(wrapCoreQuery(query, schema, runtime)))
                : undefined,
            ),
            schema,
            runtime,
          );
      }

      if (prop === "whereExists") {
        return (
          relationship: string,
          cbOrOptions?: ((query: AnyQuery) => AnyQuery) | ExistsOptions,
          options?: ExistsOptions,
        ) => {
          if (typeof cbOrOptions === "function") {
            return wrapCoreQuery(
              (
                rawQuery.whereExists as (
                  relationship: string,
                  cb: (query: AnyQuery) => AnyQuery,
                  options?: ExistsOptions,
                ) => AnyQuery
              )(
                relationship,
                (query: AnyQuery) =>
                  unwrapProxyQuery(cbOrOptions(wrapCoreQuery(query, schema, runtime))),
                options,
              ),
              schema,
              runtime,
            );
          }

          return wrapCoreQuery(
            (rawQuery.whereExists as (relationship: string, options?: ExistsOptions) => AnyQuery)(
              relationship,
              cbOrOptions,
            ),
            schema,
            runtime,
          );
        };
      }

      if (prop === "one" || prop === "limit" || prop === "orderBy" || prop === "nameAndArgs") {
        const method = Reflect.get(target, prop, target);
        return (...args: unknown[]) =>
          wrapCoreQuery(
            (typeof method === "function"
              ? (method as (...args: unknown[]) => AnyQuery).bind(target)
              : () => {
                  throw new Error(`Unsupported query method: ${String(prop)}`);
                })(...args),
            schema,
            runtime,
          );
      }

      const value = Reflect.get(target, prop, target);
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  });

  Object.defineProperty(rawQuery as unknown as Record<PropertyKey, unknown>, proxyTargetSymbol, {
    value: proxy,
    configurable: true,
  });

  return proxy as unknown as AnyQuery;
}

function getQueryTableName(query: AnyQuery) {
  return asQueryInternals(query).ast.table;
}

function makeCoreExpressionBuilder(
  rawEb: Record<string, unknown>,
  schema: Schema,
  tableName: string,
  runtime?: QueryRuntime,
) {
  return {
    eb: rawEb,
    cmp(field: string, opOrValue: unknown, value?: unknown) {
      if (arguments.length === 2) {
        return (rawEb.cmp as (field: string, value: unknown) => Condition)(
          field,
          encodeFilterValue(schema, tableName, field, "=", opOrValue),
        );
      }
      return (rawEb.cmp as (field: string, op: SimpleOperator, value: unknown) => Condition)(
        field,
        opOrValue as SimpleOperator,
        encodeFilterValue(schema, tableName, field, opOrValue as SimpleOperator, value),
      );
    },
    cmpLit: rawEb.cmpLit as (left: unknown, op: SimpleOperator, right: unknown) => Condition,
    and: rawEb.and as (...conditions: Condition[]) => Condition,
    or: rawEb.or as (...conditions: Condition[]) => Condition,
    not: rawEb.not as (condition: Condition) => Condition,
    exists(relationship: string, cb?: (query: AnyQuery) => AnyQuery, options?: ExistsOptions) {
      const rawExists = rawEb.exists as (
        relationship: string,
        cb?: (query: AnyQuery) => AnyQuery,
        options?: ExistsOptions,
      ) => Condition;
      return rawExists(
        relationship,
        cb
          ? (query: AnyQuery) => unwrapProxyQuery(cb(wrapCoreQuery(query, schema, runtime)))
          : undefined,
        options,
      );
    },
  };
}

function encodeFilterValue(
  schema: Schema,
  tableName: string,
  columnName: string,
  operator: SimpleOperator,
  value: unknown,
) {
  const transform = getColumnTransform(schema, tableName, columnName);
  if (!transform || value === undefined || value === null) {
    return value;
  }
  if (operator === "IN" || operator === "NOT IN") {
    if (!Array.isArray(value)) {
      return value;
    }
    return value.map((entry) => (entry == null ? entry : transform.encode(entry)));
  }
  return transform.encode(value);
}

function encodeRow(
  schema: Schema,
  tableName: string,
  row: Partial<Record<string, unknown>>,
): Record<string, ReadonlyJSONValue | undefined> {
  const encoded: Record<string, ReadonlyJSONValue | undefined> = {};
  for (const [key, value] of Object.entries(row)) {
    const transform = getColumnTransform(schema, tableName, key);
    if (transform && value !== undefined && value !== null) {
      encoded[key] = transform.encode(value) as ReadonlyJSONValue;
    } else {
      encoded[key] = value as ReadonlyJSONValue | undefined;
    }
  }
  return encoded;
}

export function encodeTableRow(
  schema: Schema,
  tableName: string,
  row: Partial<Record<string, unknown>>,
): Record<string, ReadonlyJSONValue | undefined> {
  return encodeRow(schema, tableName, row);
}

export function decodeQueryResult<T>(schema: Schema, query: AnyQuery, value: T): T {
  return decodeForTable(
    schema,
    getQueryTableName(query),
    asQueryInternals(query).format,
    value,
  ) as T;
}

export function decodeFormattedValue(
  schema: Schema,
  tableName: string,
  format: Format,
  value: unknown,
) {
  return decodeForTable(schema, tableName, format, value);
}

function decodeForTable(
  schema: Schema,
  tableName: string,
  format: Format,
  value: unknown,
): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  if (format.singular) {
    return decodeRowValue(schema, tableName, format, value as Record<string, unknown>);
  }
  if (!Array.isArray(value)) {
    return value;
  }
  return value.map((row) =>
    decodeRowValue(schema, tableName, format, row as Record<string, unknown>),
  );
}

function decodeRowValue(
  schema: Schema,
  tableName: string,
  format: Format,
  row: Record<string, unknown>,
) {
  const decoded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const childFormat = format.relationships[key];
    if (childFormat) {
      const relation = schema.relationships[tableName]?.[key];
      const childTable = relation?.[relation.length - 1]?.destSchema;
      decoded[key] = childTable ? decodeForTable(schema, childTable, childFormat, value) : value;
      continue;
    }
    const transform = getColumnTransform(schema, tableName, key);
    if (transform && value !== undefined && value !== null) {
      decoded[key] = transform.decode(value);
    } else {
      decoded[key] = value;
    }
  }
  return decoded;
}
