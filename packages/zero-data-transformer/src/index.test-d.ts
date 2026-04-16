/* eslint-disable no-unused-expressions */

import { expectTypeOf, test } from "vitest";
import {
  defineMutator as defineCoreMutator,
  defineMutators as defineCoreMutators,
  defineQueries as defineCoreQueries,
  defineQuery as defineCoreQuery,
  createBuilder,
  createSchema,
  string,
  table,
  type AnyMutatorRegistry,
  type AnyQueryRegistry,
  type MutatorDefinition,
  type QueryDefinition,
  type ReadonlyJSONValue,
  type Transaction,
  type ZeroOptions,
} from "@rocicorp/zero";
import { createZeroDataTransformer } from "./index";

function makeValidator<TInput, TOutput>(validate: (value: TInput) => TOutput) {
  return {
    "~standard": {
      version: 1 as const,
      vendor: "test",
      validate(value: unknown) {
        return { value: validate(value as TInput) };
      },
    },
  };
}

const issue = table("issue")
  .columns({
    id: string(),
    title: string(),
  })
  .primaryKey("id");

const schema = createSchema({
  tables: [issue],
  relationships: [],
  enableLegacyMutators: false,
  enableLegacyQueries: false,
});

const builder = createBuilder(schema);

const zt = createZeroDataTransformer({
  argsTransformer: {
    serialize(value: unknown): string | undefined {
      return value === undefined ? undefined : JSON.stringify(value);
    },
    deserialize(value: string | undefined): unknown {
      return value === undefined ? undefined : JSON.parse(value);
    },
  },
});

test("wrapped definitions remain core-compatible and wrapped registries accept rich input", () => {
  const mutatorDef = zt.defineMutator(
    makeValidator<{ when: Date }, { when: Date }>((value) => value),
    async ({ args }) => {
      expectTypeOf(args.when).toEqualTypeOf<Date>();
    },
  );

  const queryDef = zt.defineQuery(
    makeValidator<{ when: Date }, { when: Date }>((value) => value),
    ({ args }) => {
      expectTypeOf(args.when).toEqualTypeOf<Date>();
      return builder.issue.where("id", "=", "issue-1");
    },
  );

  expectTypeOf(mutatorDef).toMatchTypeOf<MutatorDefinition<any, any, any, any>>();
  expectTypeOf(queryDef).toMatchTypeOf<QueryDefinition<any, any, any, any, any>>();

  const when = {} as Date;

  const mutators = zt.defineMutators({ issue: { schedule: mutatorDef } });
  expectTypeOf(mutators).toMatchTypeOf<AnyMutatorRegistry>();
  const mutateRequest = mutators.issue.schedule({ when });
  expectTypeOf(mutateRequest.args).toMatchTypeOf<ReadonlyJSONValue | undefined>();

  const queries = zt.defineQueries({ issue: { byDate: queryDef } });
  expectTypeOf(queries).toMatchTypeOf<AnyQueryRegistry>();
  const queryRequest = queries.issue.byDate({ when });
  expectTypeOf(queryRequest.args).toMatchTypeOf<ReadonlyJSONValue | undefined>();

  const withSchema = createZeroDataTransformer({ schema });
  expectTypeOf(withSchema.createZero)
    .parameter(0)
    .toMatchTypeOf<Omit<ZeroOptions<typeof schema>, "schema">>();
  expectTypeOf(withSchema.createQueryBuilder()).toMatchTypeOf(builder);
  type TxWithExtra = Transaction<any, any> & { dbTransaction: { wrappedTransaction: string } };
  expectTypeOf(withSchema.wrapTransaction({} as TxWithExtra)).toMatchTypeOf<TxWithExtra>();
  // @ts-expect-error argsTransformer is required for defineQuery
  withSchema.defineQuery;
  // @ts-expect-error argsTransformer is required for defineQueries
  withSchema.defineQueries;

  const withoutSchema = createZeroDataTransformer();
  // @ts-expect-error schema is required for createQueryBuilder
  withoutSchema.createQueryBuilder;
  // @ts-expect-error schema is required for wrapTransaction
  withoutSchema.wrapTransaction;
  // @ts-expect-error schema is required for createQueryBuilder
  zt.createQueryBuilder;
  // @ts-expect-error schema is required for wrapTransaction
  zt.wrapTransaction;
  // @ts-expect-error schema is required for createZero
  zt.createZero;
  // @ts-expect-error no config means no wrapper methods
  withoutSchema.createZero;
  // @ts-expect-error no config means no wrapper methods
  withoutSchema.defineMutator;
  // @ts-expect-error no config means no wrapper methods
  withoutSchema.defineMutators;
  // @ts-expect-error no config means no wrapper methods
  withoutSchema.defineQuery;
  // @ts-expect-error no config means no wrapper methods
  withoutSchema.defineQueries;

  const withBoth = createZeroDataTransformer({
    schema,
    argsTransformer: {
      serialize(value: unknown): string | undefined {
        return value === undefined ? undefined : JSON.stringify(value);
      },
      deserialize(value: string | undefined): unknown {
        return value === undefined ? undefined : JSON.parse(value);
      },
    },
  });
  expectTypeOf(withBoth.createZero)
    .parameter(0)
    .toMatchTypeOf<Omit<ZeroOptions<typeof schema>, "schema">>();
  expectTypeOf(withBoth.createQueryBuilder()).toMatchTypeOf(builder);
  expectTypeOf(withBoth.wrapTransaction({} as Transaction<any, any>)).toMatchTypeOf<
    Transaction<any, any>
  >();
});

test("wrapped registries preserve optional args and merged tree typing", () => {
  const optionalMutator = zt.defineMutator(
    makeValidator<Date | undefined, Date | undefined>((value) => value),
    async ({ args }) => {
      expectTypeOf(args).toEqualTypeOf<Date | undefined>();
    },
  );
  const optionalQuery = zt.defineQuery(
    makeValidator<Date | undefined, Date | undefined>((value) => value),
    ({ args }) => {
      expectTypeOf(args).toEqualTypeOf<Date | undefined>();
      return builder.issue;
    },
  );
  const requiredMutator = zt.defineMutator(
    makeValidator<{ when: Date }, { when: Date }>((value) => value),
    async ({ args }) => {
      expectTypeOf(args.when).toEqualTypeOf<Date>();
    },
  );
  const requiredQuery = zt.defineQuery(
    makeValidator<{ when: Date }, { when: Date }>((value) => value),
    ({ args }) => {
      expectTypeOf(args.when).toEqualTypeOf<Date>();
      return builder.issue;
    },
  );

  const baseMutators = zt.defineMutators({
    issue: {
      optional: optionalMutator,
      plain: defineCoreMutator(async ({ args }: { args: string; ctx: undefined }) => {
        expectTypeOf(args).toEqualTypeOf<string>();
      }),
    },
  });
  const mergedMutators = zt.defineMutators(baseMutators, {
    issue: {
      required: requiredMutator,
    },
  });
  expectTypeOf(mergedMutators.issue.optional).toBeCallableWith();
  expectTypeOf(mergedMutators.issue.optional).toBeCallableWith({} as Date | undefined);
  expectTypeOf(mergedMutators.issue.required).toBeCallableWith({
    when: {} as Date,
  });
  expectTypeOf(mergedMutators.issue.plain).toBeCallableWith("");

  const baseQueries = zt.defineQueries({
    issue: {
      optional: optionalQuery,
      plain: defineCoreQuery(({ args }: { args: string; ctx: undefined }) => {
        expectTypeOf(args).toEqualTypeOf<string>();
        return builder.issue.where("title", "=", args);
      }),
    },
  });
  const mergedQueries = zt.defineQueries(baseQueries, {
    issue: {
      required: requiredQuery,
    },
  });
  expectTypeOf(mergedQueries.issue.optional).toBeCallableWith();
  expectTypeOf(mergedQueries.issue.optional).toBeCallableWith({} as Date | undefined);
  expectTypeOf(mergedQueries.issue.required).toBeCallableWith({
    when: {} as Date,
  });
  expectTypeOf(mergedQueries.issue.plain).toBeCallableWith("");
});

test("exact undefined and no-validator rich inputs remain callable", () => {
  const undefinedMutator = zt.defineMutator(
    makeValidator<undefined, undefined>((value) => value),
    async ({ args }) => {
      expectTypeOf(args).toEqualTypeOf<undefined>();
    },
  );
  const undefinedQuery = zt.defineQuery(
    makeValidator<undefined, undefined>((value) => value),
    ({ args }) => {
      expectTypeOf(args).toEqualTypeOf<undefined>();
      return builder.issue;
    },
  );

  const undefinedMutators = zt.defineMutators({ issue: { undef: undefinedMutator } });
  expectTypeOf(undefinedMutators.issue.undef).toBeCallableWith();
  expectTypeOf(undefinedMutators.issue.undef).toBeCallableWith(undefined);

  const undefinedQueries = zt.defineQueries({ issue: { undef: undefinedQuery } });
  expectTypeOf(undefinedQueries.issue.undef).toBeCallableWith();
  expectTypeOf(undefinedQueries.issue.undef).toBeCallableWith(undefined);

  const richMutator = zt.defineMutator(
    async ({ args }: { args: { when: Date }; ctx: undefined }) => {
      expectTypeOf(args.when).toEqualTypeOf<Date>();
    },
  );
  const richQuery = zt.defineQuery(({ args }: { args: { when: Date }; ctx: undefined }) => {
    expectTypeOf(args.when).toEqualTypeOf<Date>();
    return builder.issue;
  });

  const when = {} as Date;
  expectTypeOf(zt.defineMutators({ issue: { rich: richMutator } }).issue.rich).toBeCallableWith({
    when,
  });
  expectTypeOf(zt.defineQueries({ issue: { rich: richQuery } }).issue.rich).toBeCallableWith({
    when,
  });
});

test("wrapped definitions interoperate with core Zero builders and core registries can seed wrapped builders", () => {
  const wrappedMutator = zt.defineMutator(
    makeValidator<{ when: Date }, { when: Date }>((value) => value),
    async ({ args }) => {
      expectTypeOf(args.when).toEqualTypeOf<Date>();
    },
  );
  const wrappedQuery = zt.defineQuery(
    makeValidator<{ when: Date }, { when: Date }>((value) => value),
    ({ args }) => {
      expectTypeOf(args.when).toEqualTypeOf<Date>();
      return builder.issue;
    },
  );

  const coreMutators = defineCoreMutators({
    issue: {
      schedule: wrappedMutator,
    },
  });
  expectTypeOf(coreMutators).toMatchTypeOf<AnyMutatorRegistry>();

  const coreQueries = defineCoreQueries({
    issue: {
      byDate: wrappedQuery,
    },
  });
  expectTypeOf(coreQueries).toMatchTypeOf<AnyQueryRegistry>();

  const wrappedFromCoreBase = zt.defineMutators(coreMutators, {
    issue: {
      plain: defineCoreMutator(async ({ args }: { args: string; ctx: undefined }) => {
        expectTypeOf(args).toEqualTypeOf<string>();
      }),
    },
  });
  expectTypeOf(wrappedFromCoreBase).toMatchTypeOf<AnyMutatorRegistry>();

  const wrappedQueriesFromCoreBase = zt.defineQueries(coreQueries, {
    issue: {
      plain: defineCoreQuery(({ args }: { args: string; ctx: undefined }) => {
        expectTypeOf(args).toEqualTypeOf<string>();
        return builder.issue.where("title", "=", args);
      }),
    },
  });
  expectTypeOf(wrappedQueriesFromCoreBase).toMatchTypeOf<AnyQueryRegistry>();
});
