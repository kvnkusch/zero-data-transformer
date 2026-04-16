import { useMemo } from "react";
import {
  useQuery as baseUseQuery,
  useSuspenseQuery as baseUseSuspenseQuery,
  useZero as baseUseZero,
  type MaybeQueryResult,
  type QueryResult,
  type UseQueryOptions,
} from "@rocicorp/zero/react";
import type {
  BaseDefaultContext,
  BaseDefaultSchema,
  DefaultContext,
  DefaultSchema,
  Falsy,
  PullRow,
  Query,
  QueryOrQueryRequest,
  ReadonlyJSONValue,
} from "@rocicorp/zero";
import { decodeQueryResult } from "./query-builders.ts";

export type { UseQueryOptions };

export type UseSuspenseQueryOptions = UseQueryOptions & {
  suspendUntil?: "complete" | "partial";
};

export function useQuery<
  TTable extends keyof TSchema["tables"] & string,
  TInput extends ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined,
  TSchema extends BaseDefaultSchema = DefaultSchema,
  TReturn = PullRow<TTable, TSchema>,
  TContext extends BaseDefaultContext = DefaultContext,
>(
  query: QueryOrQueryRequest<TTable, TInput, TOutput, TSchema, TReturn, TContext>,
  options?: UseQueryOptions | boolean,
): QueryResult<TReturn>;
export function useQuery<
  TTable extends keyof TSchema["tables"] & string,
  TInput extends ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined,
  TSchema extends BaseDefaultSchema = DefaultSchema,
  TReturn = PullRow<TTable, TSchema>,
  TContext extends BaseDefaultContext = DefaultContext,
>(
  query: QueryOrQueryRequest<TTable, TInput, TOutput, TSchema, TReturn, TContext> | Falsy,
  options?: UseQueryOptions | boolean,
): MaybeQueryResult<TReturn>;
export function useQuery(
  query: QueryOrQueryRequest<any, any, any, any, any, any> | Falsy,
  options?: UseQueryOptions | boolean,
): MaybeQueryResult<any> {
  const zero = baseUseZero();
  const [data, details] = baseUseQuery(query, options);
  const decoded = useMemo(
    () => decodeData(zero.schema, zero.context, query, data),
    [zero.schema, zero.context, query, data],
  );
  return [decoded, details] as MaybeQueryResult<any>;
}

export function useSuspenseQuery<
  TTable extends keyof TSchema["tables"] & string,
  TInput extends ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined,
  TSchema extends BaseDefaultSchema = DefaultSchema,
  TReturn = PullRow<TTable, TSchema>,
  TContext extends BaseDefaultContext = DefaultContext,
>(
  query: QueryOrQueryRequest<TTable, TInput, TOutput, TSchema, TReturn, TContext>,
  options?: UseSuspenseQueryOptions | boolean,
): QueryResult<TReturn>;
export function useSuspenseQuery<
  TTable extends keyof TSchema["tables"] & string,
  TInput extends ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined,
  TSchema extends BaseDefaultSchema = DefaultSchema,
  TReturn = PullRow<TTable, TSchema>,
  TContext extends BaseDefaultContext = DefaultContext,
>(
  query: QueryOrQueryRequest<TTable, TInput, TOutput, TSchema, TReturn, TContext> | Falsy,
  options?: UseSuspenseQueryOptions | boolean,
): MaybeQueryResult<TReturn>;
export function useSuspenseQuery(
  query: QueryOrQueryRequest<any, any, any, any, any, any> | Falsy,
  options?: UseSuspenseQueryOptions | boolean,
): MaybeQueryResult<any> {
  const zero = baseUseZero();
  const [data, details] = baseUseSuspenseQuery(query, options);
  const decoded = useMemo(
    () => decodeData(zero.schema, zero.context, query, data),
    [zero.schema, zero.context, query, data],
  );
  return [decoded, details] as MaybeQueryResult<any>;
}

function decodeData(
  schema: BaseDefaultSchema,
  context: BaseDefaultContext,
  query: QueryOrQueryRequest<any, any, any, any, any, any> | Falsy,
  data: unknown,
) {
  if (!query) {
    return data;
  }

  return decodeQueryResult(
    schema,
    resolveQuery(query as QueryOrQueryRequest<any, any, any, any, any, any>, context),
    data,
  );
}

function resolveQuery(
  query: QueryOrQueryRequest<any, any, any, any, any, any>,
  context: BaseDefaultContext,
): Query<any, any, any> {
  if (typeof query === "object" && query !== null && "query" in query) {
    return query.query.fn({ args: query.args, ctx: context }) as Query<any, any, any>;
  }
  return query as Query<any, any, any>;
}
