import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  Zero,
  defineMutator as baseDefineMutator,
  defineMutators as baseDefineMutators,
  defineQueries as baseDefineQueries,
  defineQuery as baseDefineQuery,
  isMutatorRegistry,
  isQueryRegistry,
  isQueryDefinition,
  type AnyMutatorRegistry,
  type AnyQueryRegistry,
  type MutateRequest,
  type Mutator,
  type MutatorDefinition,
  type MutatorRegistry,
  type Query,
  type QueryDefinition,
  type QueryRegistry,
  type QueryRequest,
  type PullRow,
  type ReadonlyJSONValue,
  type Schema,
  type SchemaQuery,
  type Transaction,
  type ZeroOptions,
  type DefaultContext,
  type DefaultSchema,
  type DefaultWrappedTransaction,
} from "@rocicorp/zero";
import {
  handleMutateRequest as baseHandleMutateRequest,
  handleQueryRequest as baseHandleQueryRequest,
  type Database,
  type ExtractTransactionType,
  type TransactFn,
} from "@rocicorp/zero/server";
import type { LogLevel } from "@rocicorp/logger";
import { createProxyBuilder } from "./query-builders.ts";
import { wrapTransactionWithDataTransforms } from "./transaction-wrapper.ts";
import { createZeroWithDataTransforms } from "./zero-wrapper.ts";
export {
  customColumnType,
  type ColumnTransform,
  type TransformBaseType,
  type TransformedColumnBuilder,
} from "./column-transforms.ts";

const transformerMetadataSymbol: symbol = Symbol.for("zero-data-transformer/metadata");
const baseRegistrySymbol: symbol = Symbol.for("zero-data-transformer/base-registry");

type SerializedArgs = ReadonlyJSONValue | undefined;
type RawJSONInput = ReadonlyJSONValue | undefined;

type AnyMutatorDefinitionLike = MutatorDefinition<any, any, any, any>;
type AnyQueryDefinitionLike = QueryDefinition<any, any, any, any, any>;

type WrappedQueryFn<TTable extends string, TOutput, TReturn, TContext> = (options: {
  args: TOutput;
  ctx: TContext;
}) => Query<TTable, Schema, TReturn>;

type CallableWithInput<TInput, TResult> = [TInput] extends [undefined]
  ? {
      (): TResult;
      (args: undefined): TResult;
    }
  : undefined extends TInput
    ? {
        (): TResult;
        (args?: TInput): TResult;
      }
    : (args: TInput) => TResult;

export interface ArgsTransformer {
  serialize(value: unknown): SerializedArgs;
  deserialize(value: SerializedArgs): unknown;
}

type CreateZeroFn = (
  options: ZeroOptions<any, any, any> | Omit<ZeroOptions<any, any, any>, "schema">,
) => Zero<any, any, any>;

export type ZeroDataTransformerMutatorMethods<
  TSchemaDefault extends Schema = DefaultSchema,
  TContextDefault = DefaultContext,
  TWrappedTransactionDefault = DefaultWrappedTransaction,
> = {
  defineMutator: {
    <
      TInput,
      TSchema extends Schema = TSchemaDefault,
      TContext = TContextDefault,
      TWrappedTransaction = TWrappedTransactionDefault,
    >(
      mutator: MutatorHandler<TInput, TContext, TSchema, TWrappedTransaction>,
    ): WrappedMutatorDefinition<TInput, TInput, TContext, TWrappedTransaction>;
    <
      TInput,
      TOutput,
      TSchema extends Schema = TSchemaDefault,
      TContext = TContextDefault,
      TWrappedTransaction = TWrappedTransactionDefault,
    >(
      validator: StandardSchemaV1<TInput, TOutput>,
      mutator: MutatorHandler<TOutput, TContext, TSchema, TWrappedTransaction>,
    ): WrappedMutatorDefinition<TInput, TOutput, TContext, TWrappedTransaction>;
  };
  defineMutators: {
    <const MD extends WrappedMutatorDefinitions, TSchema extends Schema = TSchemaDefault>(
      definitions: MD,
    ): WrappedMutatorRegistry<MD, TSchema>;
    <
      const TBase extends WrappedMutatorDefinitions,
      const TOverrides extends WrappedMutatorDefinitions,
      TSchema extends Schema = TSchemaDefault,
    >(
      base: WrappedMutatorRegistry<TBase, TSchema>,
      overrides: TOverrides,
    ): WrappedMutatorRegistry<DeepMerge<TBase, TOverrides>, TSchema>;
    <
      const TBase extends WrappedMutatorDefinitions,
      const TOverrides extends WrappedMutatorDefinitions,
      TSchema extends Schema = TSchemaDefault,
    >(
      base: TBase,
      overrides: TOverrides,
    ): WrappedMutatorRegistry<DeepMerge<TBase, TOverrides>, TSchema>;
    (base: AnyMutatorRegistry, overrides: WrappedMutatorDefinitions): AnyMutatorRegistry;
  };
};

export type ZeroDataTransformerQueryMethods<
  TSchemaDefault extends Schema = DefaultSchema,
  TContextDefault = DefaultContext,
> = {
  defineQueries: {
    <const QD extends WrappedQueryDefinitions, TSchema extends Schema = TSchemaDefault>(
      definitions: QD,
    ): WrappedQueryRegistry<QD, TSchema>;
    <
      const TBase extends WrappedQueryDefinitions,
      const TOverrides extends WrappedQueryDefinitions,
      TSchema extends Schema = TSchemaDefault,
    >(
      base: WrappedQueryRegistry<TBase, TSchema>,
      overrides: TOverrides,
    ): WrappedQueryRegistry<DeepMerge<TBase, TOverrides>, TSchema>;
    <
      const TBase extends WrappedQueryDefinitions,
      const TOverrides extends WrappedQueryDefinitions,
      TSchema extends Schema = TSchemaDefault,
    >(
      base: TBase,
      overrides: TOverrides,
    ): WrappedQueryRegistry<DeepMerge<TBase, TOverrides>, TSchema>;
    (base: AnyQueryRegistry, overrides: WrappedQueryDefinitions): AnyQueryRegistry;
  };
  defineQuery: {
    <
      TInput = RawJSONInput,
      TContext = TContextDefault,
      TSchema extends Schema = TSchemaDefault,
      TTable extends keyof TSchema["tables"] & string = keyof TSchema["tables"] & string,
      TReturn = PullRow<TTable, TSchema>,
    >(
      query: QueryHandler<TTable, TInput, TReturn, TContext, TSchema>,
    ): WrappedQueryDefinition<TTable, TInput, TInput, TReturn, TContext>;
    <
      TInput,
      TOutput,
      TContext = TContextDefault,
      TSchema extends Schema = TSchemaDefault,
      TTable extends keyof TSchema["tables"] & string = keyof TSchema["tables"] & string,
      TReturn = PullRow<TTable, TSchema>,
    >(
      validator: StandardSchemaV1<TInput, TOutput>,
      query: QueryHandler<TTable, TOutput, TReturn, TContext, TSchema>,
    ): WrappedQueryDefinition<TTable, TInput, TOutput, TReturn, TContext>;
  };
};

type RichTransactFn<D extends Database<ExtractTransactionType<D>>> = (
  cb: (
    tx: ExtractTransactionType<D>,
    mutatorName: string,
    mutatorArgs: unknown,
  ) => Promise<void>,
) => Promise<ReadonlyJSONValue>;

type RichMutationCallback<D extends Database<ExtractTransactionType<D>>> = (
  transact: RichTransactFn<D>,
  mutation: unknown,
) => Promise<ReadonlyJSONValue>;

type RichTransformQueryFunction = (name: string, args: unknown) => Query<any, any, any>;

export type ZeroDataTransformerServerMethods = {
  handleMutateRequest: {
    <D extends Database<ExtractTransactionType<D>>>(
      dbProvider: D,
      cb: RichMutationCallback<D>,
      queryString: URLSearchParams | Record<string, string>,
      body: ReadonlyJSONValue,
      logLevel?: LogLevel,
    ): Promise<ReadonlyJSONValue>;
    <D extends Database<ExtractTransactionType<D>>>(
      dbProvider: D,
      cb: RichMutationCallback<D>,
      request: Request,
      logLevel?: LogLevel,
    ): Promise<ReadonlyJSONValue>;
  };
  handleQueryRequest: <S extends Schema>(
    transformQuery: RichTransformQueryFunction,
    schema: S,
    requestOrJsonBody: Request | ReadonlyJSONValue,
    logLevel?: LogLevel,
  ) => ReturnType<typeof baseHandleQueryRequest<S>>;
};

export type ZeroDataTransformerSchemaMethods<TSchemaDefault extends Schema> = {
  createZero: CreateZeroFn;
  createQueryBuilder: () => SchemaQuery<TSchemaDefault>;
  wrapTransaction: <TTx extends Transaction<any, any>>(tx: TTx) => TTx;
};

export type ZeroDataTransformerWithArgs<
  TSchemaDefault extends Schema = DefaultSchema,
  TContextDefault = DefaultContext,
  TWrappedTransactionDefault = DefaultWrappedTransaction,
> = ZeroDataTransformerMutatorMethods<TSchemaDefault, TContextDefault, TWrappedTransactionDefault> &
  ZeroDataTransformerQueryMethods<TSchemaDefault, TContextDefault> &
  ZeroDataTransformerServerMethods;

export type ZeroDataTransformerWithSchema<
  TSchemaDefault extends Schema,
  TContextDefault = DefaultContext,
  TWrappedTransactionDefault = DefaultWrappedTransaction,
> = ZeroDataTransformerMutatorMethods<TSchemaDefault, TContextDefault, TWrappedTransactionDefault> &
  ZeroDataTransformerSchemaMethods<TSchemaDefault>;

export type ZeroDataTransformerWithSchemaAndArgs<
  TSchemaDefault extends Schema,
  TContextDefault = DefaultContext,
  TWrappedTransactionDefault = DefaultWrappedTransaction,
> = ZeroDataTransformerWithSchema<TSchemaDefault, TContextDefault, TWrappedTransactionDefault> &
  ZeroDataTransformerQueryMethods<TSchemaDefault, TContextDefault> &
  ZeroDataTransformerServerMethods;

type ZeroDataTransformerWithoutFeatures = {};

type WrappedMutatorMetadata<TInput> = {
  kind: "mutator";
  serialize(value: TInput): SerializedArgs;
};

type WrappedQueryMetadata<TInput> = {
  kind: "query";
  serialize(value: TInput): SerializedArgs;
};

type WrappedDefinitionMetadata<TInput> =
  | WrappedMutatorMetadata<TInput>
  | WrappedQueryMetadata<TInput>;

type MetadataCarrier<TInput> = {
  readonly [transformerMetadataSymbol]: WrappedDefinitionMetadata<TInput>;
};

type BaseRegistryCarrier = {
  readonly [baseRegistrySymbol]?: Record<string, unknown>;
};

type WrappedMutatorDefinitionTypes<TInput, TOutput, TContext, TWrappedTransaction> =
  "MutatorDefinition" & {
    readonly $input: TInput;
    readonly $output: TOutput;
    readonly $context: TContext;
    readonly $wrappedTransaction: TWrappedTransaction;
  };

export type WrappedMutatorDefinition<TInput, TOutput, TContext, TWrappedTransaction> =
  AnyMutatorDefinitionLike &
    MetadataCarrier<TInput> & {
      readonly validator: StandardSchemaV1<TInput, TOutput> | undefined;
      readonly "~": WrappedMutatorDefinitionTypes<TInput, TOutput, TContext, TWrappedTransaction>;
    };

type WrappedQueryDefinitionTypes<
  TTable extends string,
  TInput,
  TOutput,
  TReturn,
  TContext,
> = "QueryDefinition" & {
  readonly $tableName: TTable;
  readonly $input: TInput;
  readonly $output: TOutput;
  readonly $return: TReturn;
  readonly $context: TContext;
};

export type WrappedQueryDefinition<
  TTable extends string,
  TInput,
  TOutput,
  TReturn,
  TContext,
> = MetadataCarrier<TInput> & {
  readonly fn: WrappedQueryFn<TTable, TOutput, TReturn, TContext>;
  readonly validator: StandardSchemaV1<TInput, TOutput> | undefined;
  readonly "~": WrappedQueryDefinitionTypes<TTable, TInput, TOutput, TReturn, TContext>;
};

type MutatorDefinitionLeaf =
  | AnyMutatorDefinitionLike
  | WrappedMutatorDefinition<any, any, any, any>;

export type WrappedMutatorDefinitions = {
  readonly [key: string]: MutatorDefinitionLeaf | WrappedMutatorDefinitions;
};

type QueryDefinitionLeaf = AnyQueryDefinitionLike | WrappedQueryDefinition<any, any, any, any, any>;

export type WrappedQueryDefinitions = {
  readonly [key: string]: QueryDefinitionLeaf | WrappedQueryDefinitions;
};

type SerializedWrappedMutatorDefinitions<MD extends WrappedMutatorDefinitions> = {
  readonly [K in keyof MD]: MD[K] extends WrappedMutatorDefinition<
    any,
    any,
    infer TContext,
    infer TWrappedTransaction
  >
    ? MutatorDefinition<SerializedArgs, SerializedArgs, TContext, TWrappedTransaction>
    : MD[K] extends MutatorDefinition<infer TInput, infer TOutput, infer TContext, infer TWrappedTransaction>
      ? MutatorDefinition<TInput, TOutput, TContext, TWrappedTransaction>
      : MD[K] extends WrappedMutatorDefinitions
        ? SerializedWrappedMutatorDefinitions<MD[K]>
        : never;
};

type SerializedWrappedQueryDefinitions<QD extends WrappedQueryDefinitions> = {
  readonly [K in keyof QD]: QD[K] extends WrappedQueryDefinition<
    infer TTable,
    any,
    any,
    infer TReturn,
    infer TContext
  >
    ? QueryDefinition<TTable, SerializedArgs, SerializedArgs, TReturn, TContext>
    : QD[K] extends QueryDefinition<
          infer TTable,
          infer TInput,
          infer TOutput,
          infer TReturn,
          infer TContext
        >
      ? QueryDefinition<TTable, TInput, TOutput, TReturn, TContext>
      : QD[K] extends WrappedQueryDefinitions
        ? SerializedWrappedQueryDefinitions<QD[K]>
        : never;
};

type InferWrappedMutator<Def, TSchema extends Schema> = Def extends MetadataCarrier<infer TInput> &
  MutatorDefinition<any, any, infer TContext, infer TWrappedTransaction>
  ? Mutator<SerializedArgs, TSchema, TContext, TWrappedTransaction> &
      CallableWithInput<
        TInput,
        MutateRequest<SerializedArgs, TSchema, TContext, TWrappedTransaction>
      > & {
        fn: Mutator<SerializedArgs, TSchema, TContext, TWrappedTransaction>["fn"] &
          ((options: {
            args: TInput;
            ctx: TContext;
            tx: Transaction<TSchema, TWrappedTransaction>;
          }) => Promise<void>);
      }
  : Def extends MutatorDefinition<infer TInput, any, infer TContext, infer TWrappedTransaction>
    ? Mutator<TInput, TSchema, TContext, TWrappedTransaction>
    : never;

type WrappedMutatorTree<MD extends WrappedMutatorDefinitions, TSchema extends Schema> = {
  readonly [K in keyof MD]: MD[K] extends MutatorDefinitionLeaf
    ? InferWrappedMutator<MD[K], TSchema>
    : MD[K] extends WrappedMutatorDefinitions
      ? WrappedMutatorTree<MD[K], TSchema>
      : never;
};

export type WrappedMutatorRegistry<MD extends WrappedMutatorDefinitions, TSchema extends Schema> =
  MutatorRegistry<SerializedWrappedMutatorDefinitions<MD>, TSchema> &
    WrappedMutatorTree<MD, TSchema>;

type InferWrappedQuery<Def, TSchema extends Schema> = Def extends MetadataCarrier<infer TInput> &
  QueryDefinition<infer TTable, any, any, infer TReturn, infer TContext>
  ? QueryRequest<
      TTable & keyof TSchema["tables"] & string,
      SerializedArgs,
      SerializedArgs,
      TSchema,
      TReturn,
      TContext
    >["query"] &
      CallableWithInput<
        TInput,
        QueryRequest<
          TTable & keyof TSchema["tables"] & string,
          SerializedArgs,
          SerializedArgs,
          TSchema,
          TReturn,
          TContext
        >
      > & {
        fn: QueryRequest<
          TTable & keyof TSchema["tables"] & string,
          SerializedArgs,
          SerializedArgs,
          TSchema,
          TReturn,
          TContext
        >["query"]["fn"] &
          ((options: {
            args: TInput;
            ctx: TContext;
          }) => Query<TTable & keyof TSchema["tables"] & string, TSchema, TReturn>);
      }
  : Def extends QueryDefinition<
        infer TTable,
        infer TInput,
        infer TOutput,
        infer TReturn,
        infer TContext
      >
    ? QueryRequest<
        TTable & keyof TSchema["tables"] & string,
        TInput,
        TOutput,
        TSchema,
        TReturn,
        TContext
      >["query"]
    : never;

type WrappedQueryTree<QD extends WrappedQueryDefinitions, TSchema extends Schema> = {
  readonly [K in keyof QD]: QD[K] extends QueryDefinitionLeaf
    ? InferWrappedQuery<QD[K], TSchema>
    : QD[K] extends WrappedQueryDefinitions
      ? WrappedQueryTree<QD[K], TSchema>
      : never;
};

export type WrappedQueryRegistry<QD extends WrappedQueryDefinitions, TSchema extends Schema> =
  QueryRegistry<SerializedWrappedQueryDefinitions<QD>, TSchema> &
    WrappedQueryTree<QD, TSchema>;

type PathEntry<T, P extends string> = P extends `${infer Head}.${infer Tail}`
  ? Head extends keyof T
    ? PathEntry<T[Head], Tail>
    : never
  : P extends keyof T
    ? T[P]
    : never;

type DynamicMutatorLeaf = {
  fn(options: {
    args: unknown;
    ctx: unknown;
    tx: unknown;
  }): Promise<void>;
};

type DynamicQueryLeaf = {
  fn(options: {
    args: unknown;
    ctx: unknown;
  }): Query<any, any, any>;
};

type MutatorLookupEntry<
  MD extends WrappedMutatorDefinitions,
  TSchema extends Schema,
  TName extends string,
> = string extends TName
  ? DynamicMutatorLeaf
  : PathEntry<WrappedMutatorTree<MD, TSchema>, TName>;

type QueryLookupEntry<
  QD extends WrappedQueryDefinitions,
  TSchema extends Schema,
  TName extends string,
> = string extends TName
  ? DynamicQueryLeaf
  : PathEntry<WrappedQueryTree<QD, TSchema>, TName>;

export function mustGetMutator<
  MD extends WrappedMutatorDefinitions,
  TSchema extends Schema,
  TName extends string,
>(
  registry: WrappedMutatorRegistry<MD, TSchema>,
  name: TName,
): MutatorLookupEntry<MD, TSchema, TName> {
  return mustGetRegistryEntry(registry, name, 'mutator') as MutatorLookupEntry<MD, TSchema, TName>;
}

export function mustGetQuery<
  QD extends WrappedQueryDefinitions,
  TSchema extends Schema,
  TName extends string,
>(
  registry: WrappedQueryRegistry<QD, TSchema>,
  name: TName,
): QueryLookupEntry<QD, TSchema, TName> {
  return mustGetRegistryEntry(registry, name, 'query') as QueryLookupEntry<QD, TSchema, TName>;
}

function mustGetRegistryEntry(
  registry: Record<string, unknown>,
  name: string,
  kind: 'mutator' | 'query',
): unknown {
  let current: unknown = registry;
  for (const part of name.split('.')) {
    if (typeof current !== 'object' || current === null || !(part in current)) {
      throw new Error(`Unknown ${kind}: ${name}`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current !== 'function' || current === null || !('fn' in current)) {
    throw new Error(`Unknown ${kind}: ${name}`);
  }
  return current;
}

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type IsPlainObject<T> = T extends object
  ? T extends Function | readonly unknown[]
    ? false
    : true
  : false;

type IsLeaf<T, Leaf> = [T] extends [Leaf] ? true : false;

type MergeValue<A, B, Leaf> =
  IsLeaf<A, Leaf> extends true
    ? B
    : IsLeaf<B, Leaf> extends true
      ? B
      : IsPlainObject<A> extends true
        ? IsPlainObject<B> extends true
          ? DeepMerge<A & {}, B & {}, Leaf>
          : B
        : B;

type DeepMerge<A, B, Leaf = never> = Simplify<
  Omit<A, keyof B> & {
    [K in keyof B]: K extends keyof A ? MergeValue<A[K], B[K], Leaf> : B[K];
  }
>;

type MutatorHandler<TOutput, TContext, TSchema extends Schema, TWrappedTransaction> = (options: {
  args: TOutput;
  ctx: TContext;
  tx: Transaction<TSchema, TWrappedTransaction>;
}) => Promise<void>;

type QueryHandler<
  TTable extends keyof TSchema["tables"] & string,
  TOutput,
  TReturn,
  TContext,
  TSchema extends Schema,
> = (options: { args: TOutput; ctx: TContext }) => Query<TTable, TSchema, TReturn>;

function isStandardSchema(value: unknown): value is StandardSchemaV1<unknown, unknown> {
  return typeof value === "object" && value !== null && "~standard" in value;
}

function createValidator<TInput, TOutput>(
  argsTransformer: ArgsTransformer,
  validator: StandardSchemaV1<TInput, TOutput> | undefined,
): StandardSchemaV1<SerializedArgs, TOutput> {
  return {
    "~standard": {
      version: 1,
      vendor: "zero-data-transformer",
      validate(value) {
        const decoded = argsTransformer.deserialize(value as SerializedArgs) as TInput;
        if (!validator) {
          return { value: decoded as unknown as TOutput };
        }
        return validator["~standard"].validate(decoded);
      },
    },
  } as StandardSchemaV1<SerializedArgs, TOutput>;
}

function wrapMutatorDefinition<
  TInput,
  TOutput,
  TSchema extends Schema,
  TContext,
  TWrappedTransaction,
>(
  argsTransformer: ArgsTransformer | undefined,
  validator: StandardSchemaV1<TInput, TOutput> | undefined,
  mutator: MutatorHandler<TOutput, TContext, TSchema, TWrappedTransaction>,
  schema: Schema | undefined,
): WrappedMutatorDefinition<TInput, TOutput, TContext, TWrappedTransaction> {
  const wrappedMutator: MutatorHandler<TOutput, TContext, TSchema, TWrappedTransaction> = async ({
    args,
    ctx,
    tx,
  }) =>
    mutator({
      args,
      ctx,
      tx: schema
        ? (wrapTransactionWithDataTransforms(schema, tx as never) as unknown as Transaction<
            TSchema,
            TWrappedTransaction
          >)
        : tx,
    });
  const baseDefinition = argsTransformer
    ? baseDefineMutator(
        createValidator(argsTransformer, validator) as StandardSchemaV1<
          SerializedArgs,
          SerializedArgs
        >,
        wrappedMutator as unknown as MutatorHandler<
          SerializedArgs,
          TContext,
          TSchema,
          TWrappedTransaction
        >,
      )
    : validator
      ? baseDefineMutator(validator as never, wrappedMutator as never)
      : baseDefineMutator(wrappedMutator as never);

  if (!argsTransformer) {
    return baseDefinition as unknown as WrappedMutatorDefinition<
      TInput,
      TOutput,
      TContext,
      TWrappedTransaction
    >;
  }

  return Object.assign(baseDefinition, {
    [transformerMetadataSymbol]: {
      kind: "mutator" as const,
      serialize(value: TInput) {
        return argsTransformer.serialize(value);
      },
    },
  }) as unknown as WrappedMutatorDefinition<TInput, TOutput, TContext, TWrappedTransaction>;
}

function wrapQueryDefinition<
  TTable extends keyof TSchema["tables"] & string,
  TInput,
  TOutput,
  TSchema extends Schema,
  TReturn,
  TContext,
>(
  argsTransformer: ArgsTransformer | undefined,
  validator: StandardSchemaV1<TInput, TOutput> | undefined,
  query: QueryHandler<TTable, TOutput, TReturn, TContext, TSchema>,
): WrappedQueryDefinition<TTable, TInput, TOutput, TReturn, TContext> {
  const baseDefinition = argsTransformer
    ? baseDefineQuery(
        createValidator(argsTransformer, validator) as StandardSchemaV1<
          SerializedArgs,
          SerializedArgs
        >,
        query as never,
      )
    : validator
      ? baseDefineQuery(validator as never, query as never)
      : baseDefineQuery(query as never);

  if (!argsTransformer) {
    return baseDefinition as unknown as WrappedQueryDefinition<
      TTable,
      TInput,
      TOutput,
      TReturn,
      TContext
    >;
  }

  return Object.assign(baseDefinition, {
    [transformerMetadataSymbol]: {
      kind: "query" as const,
      serialize(value: TInput) {
        return argsTransformer.serialize(value);
      },
    },
  }) as unknown as WrappedQueryDefinition<TTable, TInput, TOutput, TReturn, TContext>;
}

function getMetadata<TInput>(value: unknown): WrappedDefinitionMetadata<TInput> | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return (value as MetadataCarrier<TInput>)[transformerMetadataSymbol];
}

function wrapMutatorTree(
  registry: Record<string, unknown>,
  definitions?: WrappedMutatorDefinitions,
): Record<string, unknown> {
  const wrapped: Record<string, unknown> = { ...registry };
  Object.defineProperty(wrapped, baseRegistrySymbol, {
    value: registry,
    configurable: true,
  });

  for (const [key, baseValue] of Object.entries(registry)) {
    if (key === "~") {
      continue;
    }

    const definition = definitions?.[key];
    if (definition === undefined) {
      wrapped[key] = baseValue;
      continue;
    }

    const metadata = getMetadata(definition);
    if (metadata?.kind === "mutator") {
      const baseMutator = baseValue as Mutator<SerializedArgs, Schema, unknown, unknown>;
      const wrappedMutator = ((args?: unknown) => {
        const serializedArgs = metadata.serialize(args);
        return {
          args: serializedArgs,
          "~": "MutateRequest" as const,
          mutator: baseMutator,
        };
      }) as Mutator<SerializedArgs, Schema, unknown, unknown>;
      const wrappedFn = (async ({
        args,
        ctx,
        tx,
      }: {
        args: unknown;
        ctx: unknown;
        tx: unknown;
      }) =>
        baseMutator.fn({
          args: metadata.serialize(args),
          ctx,
          tx: tx as Transaction<Schema, unknown>,
        })) as typeof baseMutator.fn;
      Object.assign(wrappedMutator, {
        mutatorName: baseMutator.mutatorName,
        fn: wrappedFn,
        "~": baseMutator["~"],
      });
      wrapped[key] = wrappedMutator;
      continue;
    }

    if (isMutatorDefinitionLike(definition)) {
      wrapped[key] = baseValue;
      continue;
    }

    wrapped[key] = wrapMutatorTree(
      baseValue as Record<string, unknown>,
      definition as WrappedMutatorDefinitions,
    );
  }

  return wrapped;
}

function wrapQueryTree(
  registry: Record<string, unknown>,
  definitions?: WrappedQueryDefinitions,
): Record<string, unknown> {
  const wrapped: Record<string, unknown> = { ...registry };
  Object.defineProperty(wrapped, baseRegistrySymbol, {
    value: registry,
    configurable: true,
  });

  for (const [key, baseValue] of Object.entries(registry)) {
    if (key === "~") {
      continue;
    }

    const definition = definitions?.[key];
    if (definition === undefined) {
      wrapped[key] = baseValue;
      continue;
    }

    const metadata = getMetadata(definition);
    if (metadata?.kind === "query") {
      const baseQuery = baseValue as QueryRequest<
        any,
        SerializedArgs,
        SerializedArgs,
        Schema,
        unknown,
        unknown
      >["query"];
      const wrappedQuery = ((args?: unknown) => {
        const serializedArgs = metadata.serialize(args);
        return {
          args: serializedArgs,
          "~": "QueryRequest" as const,
          query: baseQuery,
        };
      }) as QueryRequest<any, SerializedArgs, SerializedArgs, Schema, unknown, unknown>["query"];
      const wrappedFn = (({
        args,
        ctx,
      }: {
        args: unknown;
        ctx: unknown;
      }) =>
        baseQuery.fn({
          args: metadata.serialize(args),
          ctx,
        })) as typeof baseQuery.fn;
      Object.assign(wrappedQuery, {
        queryName: baseQuery.queryName,
        fn: wrappedFn,
        "~": baseQuery["~"],
      });
      wrapped[key] = wrappedQuery;
      continue;
    }

    if (isQueryDefinition(definition)) {
      wrapped[key] = baseValue;
      continue;
    }

    wrapped[key] = wrapQueryTree(
      baseValue as Record<string, unknown>,
      definition as WrappedQueryDefinitions,
    );
  }

  return wrapped;
}

function isMutatorDefinitionLike(value: unknown): value is AnyMutatorDefinitionLike {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { "~"?: unknown })["~"] === "MutatorDefinition"
  );
}

function getBaseRegistry<T extends Record<string, unknown>>(value: T): T {
  return ((value as BaseRegistryCarrier)[baseRegistrySymbol] as T | undefined) ?? value;
}


export function createZeroDataTransformer<
  TSchemaDefault extends Schema,
  TContextDefault = DefaultContext,
  TWrappedTransactionDefault = DefaultWrappedTransaction,
>(options: {
  schema: TSchemaDefault;
  argsTransformer: ArgsTransformer;
}): ZeroDataTransformerWithSchemaAndArgs<
  TSchemaDefault,
  TContextDefault,
  TWrappedTransactionDefault
>;
export function createZeroDataTransformer<
  TSchemaDefault extends Schema,
  TContextDefault = DefaultContext,
  TWrappedTransactionDefault = DefaultWrappedTransaction,
>(options: {
  schema: TSchemaDefault;
  argsTransformer?: undefined;
}): ZeroDataTransformerWithSchema<TSchemaDefault, TContextDefault, TWrappedTransactionDefault>;
export function createZeroDataTransformer<
  TSchemaDefault extends Schema = DefaultSchema,
  TContextDefault = DefaultContext,
  TWrappedTransactionDefault = DefaultWrappedTransaction,
>(options: {
  argsTransformer: ArgsTransformer;
  schema?: undefined;
}): ZeroDataTransformerWithArgs<TSchemaDefault, TContextDefault, TWrappedTransactionDefault>;
export function createZeroDataTransformer(options?: {
  argsTransformer?: undefined;
  schema?: undefined;
}): ZeroDataTransformerWithoutFeatures;
export function createZeroDataTransformer<
  TSchemaDefault extends Schema = DefaultSchema,
  TContextDefault = DefaultContext,
  TWrappedTransactionDefault = DefaultWrappedTransaction,
>(
  options:
    | {
        schema: TSchemaDefault;
        argsTransformer: ArgsTransformer;
      }
    | {
        schema: TSchemaDefault;
        argsTransformer?: undefined;
      }
    | {
        argsTransformer: ArgsTransformer;
        schema?: undefined;
      }
    | {
        argsTransformer?: undefined;
        schema?: undefined;
      } = {},
):
  | ZeroDataTransformerWithSchemaAndArgs<
      TSchemaDefault,
      TContextDefault,
      TWrappedTransactionDefault
    >
  | ZeroDataTransformerWithSchema<
      TSchemaDefault,
      TContextDefault,
      TWrappedTransactionDefault
    >
  | ZeroDataTransformerWithArgs<
      TSchemaDefault,
      TContextDefault,
      TWrappedTransactionDefault
    >
  | ZeroDataTransformerWithoutFeatures {
  const { argsTransformer, schema } = options;

  function createQueryBuilder(): SchemaQuery<TSchemaDefault> {
    if (!schema) {
      throw new Error("createQueryBuilder() requires createZeroDataTransformer({ schema })");
    }

    return createProxyBuilder(schema as TSchemaDefault);
  }

  function wrapTransaction<TTx extends Transaction<any, any>>(this: void, tx: TTx): TTx {
    if (!schema) {
      throw new Error("wrapTransaction() requires createZeroDataTransformer({ schema })");
    }

    return wrapTransactionWithDataTransforms(schema, tx);
  }

  function defineMutator<
    TInput,
    TSchema extends Schema = TSchemaDefault,
    TContext = TContextDefault,
    TWrappedTransaction = TWrappedTransactionDefault,
  >(
    mutator: MutatorHandler<TInput, TContext, TSchema, TWrappedTransaction>,
  ): WrappedMutatorDefinition<TInput, TInput, TContext, TWrappedTransaction>;
  function defineMutator<
    TInput,
    TOutput,
    TSchema extends Schema = TSchemaDefault,
    TContext = TContextDefault,
    TWrappedTransaction = TWrappedTransactionDefault,
  >(
    validator: StandardSchemaV1<TInput, TOutput>,
    mutator: MutatorHandler<TOutput, TContext, TSchema, TWrappedTransaction>,
  ): WrappedMutatorDefinition<TInput, TOutput, TContext, TWrappedTransaction>;
  function defineMutator<
    TInput,
    TOutput,
    TSchema extends Schema = TSchemaDefault,
    TContext = TContextDefault,
    TWrappedTransaction = TWrappedTransactionDefault,
  >(
    validatorOrMutator:
      | StandardSchemaV1<TInput, TOutput>
      | MutatorHandler<TInput, TContext, TSchema, TWrappedTransaction>,
    mutator?: MutatorHandler<TOutput, TContext, TSchema, TWrappedTransaction>,
  ) {
    if (isStandardSchema(validatorOrMutator)) {
      return wrapMutatorDefinition(
        argsTransformer,
        validatorOrMutator,
        mutator as MutatorHandler<TOutput, TContext, TSchema, TWrappedTransaction>,
        schema,
      );
    }

    return wrapMutatorDefinition(
      argsTransformer,
      undefined,
      validatorOrMutator as MutatorHandler<TInput, TContext, TSchema, TWrappedTransaction>,
      schema,
    );
  }

  function defineQuery<
    TInput = RawJSONInput,
    TContext = TContextDefault,
    TSchema extends Schema = TSchemaDefault,
    TTable extends keyof TSchema["tables"] & string = keyof TSchema["tables"] & string,
    TReturn = PullRow<TTable, TSchema>,
  >(
    query: QueryHandler<TTable, TInput, TReturn, TContext, TSchema>,
  ): WrappedQueryDefinition<TTable, TInput, TInput, TReturn, TContext>;
  function defineQuery<
    TInput,
    TOutput,
    TContext = TContextDefault,
    TSchema extends Schema = TSchemaDefault,
    TTable extends keyof TSchema["tables"] & string = keyof TSchema["tables"] & string,
    TReturn = PullRow<TTable, TSchema>,
  >(
    validator: StandardSchemaV1<TInput, TOutput>,
    query: QueryHandler<TTable, TOutput, TReturn, TContext, TSchema>,
  ): WrappedQueryDefinition<TTable, TInput, TOutput, TReturn, TContext>;
  function defineQuery<
    TInput,
    TOutput,
    TContext = TContextDefault,
    TSchema extends Schema = TSchemaDefault,
    TTable extends keyof TSchema["tables"] & string = keyof TSchema["tables"] & string,
    TReturn = PullRow<TTable, TSchema>,
  >(
    validatorOrQuery:
      | StandardSchemaV1<TInput, TOutput>
      | QueryHandler<TTable, TInput, TReturn, TContext, TSchema>,
    query?: QueryHandler<TTable, TOutput, TReturn, TContext, TSchema>,
  ) {
    if (isStandardSchema(validatorOrQuery)) {
      return wrapQueryDefinition(
        argsTransformer,
        validatorOrQuery,
        query as QueryHandler<TTable, TOutput, TReturn, TContext, TSchema>,
      );
    }

    return wrapQueryDefinition(
      argsTransformer,
      undefined,
      validatorOrQuery as QueryHandler<TTable, TInput, TReturn, TContext, TSchema>,
    );
  }

  function defineMutators<
    const MD extends WrappedMutatorDefinitions,
    TSchema extends Schema = TSchemaDefault,
  >(definitions: MD): WrappedMutatorRegistry<MD, TSchema>;
  function defineMutators<
    const TBase extends WrappedMutatorDefinitions,
    const TOverrides extends WrappedMutatorDefinitions,
    TSchema extends Schema = TSchemaDefault,
  >(
    base: WrappedMutatorRegistry<TBase, TSchema>,
    overrides: TOverrides,
  ): WrappedMutatorRegistry<DeepMerge<TBase, TOverrides>, TSchema>;
  function defineMutators<
    const TBase extends WrappedMutatorDefinitions,
    const TOverrides extends WrappedMutatorDefinitions,
    TSchema extends Schema = TSchemaDefault,
  >(
    base: TBase,
    overrides: TOverrides,
  ): WrappedMutatorRegistry<DeepMerge<TBase, TOverrides>, TSchema>;
  function defineMutators(
    base: AnyMutatorRegistry,
    overrides: WrappedMutatorDefinitions,
  ): AnyMutatorRegistry;
  function defineMutators<
    const TBase extends WrappedMutatorDefinitions,
    const TOverrides extends WrappedMutatorDefinitions,
    TSchema extends Schema = TSchemaDefault,
  >(
    definitionsOrBase: WrappedMutatorRegistry<TBase, TSchema> | TBase | AnyMutatorRegistry,
    maybeOverrides?: TOverrides,
  ) {
    if (!argsTransformer) {
      if (maybeOverrides === undefined) {
        return baseDefineMutators(definitionsOrBase as never);
      }

      const baseRegistry = isMutatorRegistry(definitionsOrBase)
        ? definitionsOrBase
        : defineMutators<TBase, TSchema>(definitionsOrBase);
      return baseDefineMutators(baseRegistry as never, maybeOverrides as never);
    }

    if (maybeOverrides === undefined) {
      const baseRegistry = baseDefineMutators(definitionsOrBase as never);
      return wrapMutatorTree(
        baseRegistry as Record<string, unknown>,
        definitionsOrBase as WrappedMutatorDefinitions,
      ) as WrappedMutatorRegistry<TBase, TSchema>;
    }

    const baseRegistry = isMutatorRegistry(definitionsOrBase)
      ? definitionsOrBase
      : defineMutators<TBase, TSchema>(definitionsOrBase);
    const mergedRegistry = baseDefineMutators(baseRegistry as never, maybeOverrides as never);
    return wrapMutatorTree(
      mergedRegistry as Record<string, unknown>,
      maybeOverrides,
    ) as WrappedMutatorRegistry<DeepMerge<TBase, TOverrides>, TSchema>;
  }

  function defineQueries<
    const QD extends WrappedQueryDefinitions,
    TSchema extends Schema = TSchemaDefault,
  >(definitions: QD): WrappedQueryRegistry<QD, TSchema>;
  function defineQueries<
    const TBase extends WrappedQueryDefinitions,
    const TOverrides extends WrappedQueryDefinitions,
    TSchema extends Schema = TSchemaDefault,
  >(
    base: WrappedQueryRegistry<TBase, TSchema>,
    overrides: TOverrides,
  ): WrappedQueryRegistry<DeepMerge<TBase, TOverrides>, TSchema>;
  function defineQueries<
    const TBase extends WrappedQueryDefinitions,
    const TOverrides extends WrappedQueryDefinitions,
    TSchema extends Schema = TSchemaDefault,
  >(
    base: TBase,
    overrides: TOverrides,
  ): WrappedQueryRegistry<DeepMerge<TBase, TOverrides>, TSchema>;
  function defineQueries(
    base: AnyQueryRegistry,
    overrides: WrappedQueryDefinitions,
  ): AnyQueryRegistry;
  function defineQueries<
    const TBase extends WrappedQueryDefinitions,
    const TOverrides extends WrappedQueryDefinitions,
    TSchema extends Schema = TSchemaDefault,
  >(
    definitionsOrBase: WrappedQueryRegistry<TBase, TSchema> | TBase | AnyQueryRegistry,
    maybeOverrides?: TOverrides,
  ) {
    if (!argsTransformer) {
      if (maybeOverrides === undefined) {
        return baseDefineQueries(definitionsOrBase as never);
      }

      const baseRegistry = isQueryRegistry(definitionsOrBase)
        ? definitionsOrBase
        : defineQueries<TBase, TSchema>(definitionsOrBase);
      return baseDefineQueries(baseRegistry as never, maybeOverrides as never);
    }

    if (maybeOverrides === undefined) {
      const baseRegistry = baseDefineQueries(definitionsOrBase as never);
      return wrapQueryTree(
        baseRegistry as Record<string, unknown>,
        definitionsOrBase as WrappedQueryDefinitions,
      ) as WrappedQueryRegistry<TBase, TSchema>;
    }

    const baseRegistry = isQueryRegistry(definitionsOrBase)
      ? definitionsOrBase
      : defineQueries<TBase, TSchema>(definitionsOrBase);
    const mergedRegistry = baseDefineQueries(baseRegistry as never, maybeOverrides as never);
    return wrapQueryTree(
      mergedRegistry as Record<string, unknown>,
      maybeOverrides,
    ) as WrappedQueryRegistry<DeepMerge<TBase, TOverrides>, TSchema>;
  }

  function handleMutateRequest<D extends Database<ExtractTransactionType<D>>>(
    dbProvider: D,
    cb: RichMutationCallback<D>,
    queryStringOrRequest: URLSearchParams | Record<string, string> | Request,
    bodyOrLogLevel?: ReadonlyJSONValue | LogLevel,
    maybeLogLevel?: LogLevel,
  ) {
    if (!argsTransformer) {
      throw new Error("handleMutateRequest() requires createZeroDataTransformer({ argsTransformer })");
    }

    const { deserialize } = argsTransformer;
    const wrappedCb = (transact: TransactFn<D>, mutation: unknown) =>
      cb(
        innerCb =>
          transact((tx, name, args) =>
            innerCb(tx, name, deserialize(args as SerializedArgs)),
          ),
        mutation,
      );

    if (queryStringOrRequest instanceof Request) {
      return baseHandleMutateRequest(
        dbProvider,
        wrappedCb as never,
        queryStringOrRequest,
        bodyOrLogLevel as LogLevel | undefined,
      );
    }

    return baseHandleMutateRequest(
      dbProvider,
      wrappedCb as never,
      queryStringOrRequest,
      bodyOrLogLevel as ReadonlyJSONValue,
      maybeLogLevel,
    );
  }

  function handleQueryRequest<S extends Schema>(
    transformQuery: RichTransformQueryFunction,
    schema: S,
    requestOrJsonBody: Request | ReadonlyJSONValue,
    logLevel?: LogLevel,
  ) {
    if (!argsTransformer) {
      throw new Error("handleQueryRequest() requires createZeroDataTransformer({ argsTransformer })");
    }

    const { deserialize } = argsTransformer;

    return baseHandleQueryRequest(
      (name, args) => transformQuery(name, deserialize(args as SerializedArgs)),
      schema,
      requestOrJsonBody,
      logLevel,
    );
  }

  function createZero(
    options: ZeroOptions<any, any, any> | Omit<ZeroOptions<any, any, any>, "schema">,
  ) {
    const baseMutators =
      "mutators" in options && options.mutators
        ? getBaseRegistry(options.mutators as Record<string, unknown>)
        : options.mutators;

    const zero = new Zero({
      ...options,
      mutators: baseMutators,
      schema: schema ?? (options as ZeroOptions<any, any, any>).schema,
    } as never);

    return schema ? createZeroWithDataTransforms(zero as never) : zero;
  }

  const transformer = {
    createQueryBuilder: createQueryBuilder as typeof createQueryBuilder,
    createZero: createZero as typeof createZero,
    defineMutator: defineMutator as typeof defineMutator,
    defineMutators: defineMutators as typeof defineMutators,
    ...(argsTransformer
      ? {
          handleMutateRequest,
          handleQueryRequest,
        }
      : {}),
    defineQueries: defineQueries as typeof defineQueries,
    defineQuery: defineQuery as typeof defineQuery,
    wrapTransaction: wrapTransaction as typeof wrapTransaction,
  };

  return transformer;
}
