import { describe, expect, test, vi } from "vitest";
import { parse as devalueParse, stringify as devalueStringify } from "devalue";
import superjson from "superjson";
import {
  createBuilder,
  createSchema,
  defineMutator as defineCoreMutator,
  defineQuery as defineCoreQuery,
  string,
  table,
  type ReadonlyJSONValue,
} from "@rocicorp/zero";
import { asQueryInternals } from "@rocicorp/zero/bindings";
import { customColumnType } from "./column-transforms";
import { createProxyBuilder } from "./query-builders";
import { createZeroDataTransformer, type ArgsTransformer } from "./index";

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

const timestamp = customColumnType({
  base: "number" as const,
  encode(value: Date) {
    return value.getTime();
  },
  decode(value: number) {
    return new Date(value);
  },
});

const issue = table("issue")
  .columns({
    id: string(),
    title: string(),
    createdAt: timestamp(),
  })
  .primaryKey("id");

const schema = createSchema({
  tables: [issue],
  relationships: [],
  enableLegacyMutators: false,
  enableLegacyQueries: false,
});

const rawBuilder = createBuilder(schema);
const builder = createProxyBuilder(schema);

const transformer = {
  serialize(value: unknown): string | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value instanceof Date) {
      return JSON.stringify({ type: "Date", value: value.toISOString() });
    }
    if (
      typeof value === "object" &&
      value !== null &&
      "when" in value &&
      (value as { when: unknown }).when instanceof Date
    ) {
      const typedValue = value as { id: string; when: Date };
      return JSON.stringify({
        id: typedValue.id,
        when: { type: "Date", value: typedValue.when.toISOString() },
      });
    }
    return JSON.stringify(value);
  },
  deserialize(value: string | undefined): unknown {
    if (value === undefined) {
      return undefined;
    }
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      (parsed as { type: unknown }).type === "Date" &&
      "value" in parsed
    ) {
      return new Date((parsed as { value: string }).value);
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "when" in parsed &&
      typeof (parsed as { when: unknown }).when === "object" &&
      (parsed as { when: { type?: string } }).when?.type === "Date"
    ) {
      const typedValue = parsed as {
        id: string;
        when: { type: "Date"; value: string };
      };
      return {
        id: typedValue.id,
        when: new Date(typedValue.when.value),
      };
    }
    return parsed;
  },
};

describe("createZeroDataTransformer", () => {
  test("serializes on mutator call and deserializes before execution", async () => {
    const zt = createZeroDataTransformer({ argsTransformer: transformer });
    let received: { id: string; when: Date } | undefined;

    const defs = {
      issue: {
        schedule: zt.defineMutator(
          makeValidator<{ id: string; when: Date }, { id: string; when: Date }>((value) => value),
          async ({ args }) => {
            received = args;
          },
        ),
      },
    };

    const mutators = zt.defineMutators(defs);
    const request = mutators.issue.schedule({
      id: "issue-1",
      when: new Date("2025-01-02T03:04:05.000Z"),
    });

    expect(request.args).toBe(
      JSON.stringify({
        id: "issue-1",
        when: { type: "Date", value: "2025-01-02T03:04:05.000Z" },
      }),
    );

    await request.mutator.fn({
      args: request.args,
      ctx: undefined,
      tx: {} as never,
    });

    expect(received).toEqual({
      id: "issue-1",
      when: new Date("2025-01-02T03:04:05.000Z"),
    });
  });

  test("serializes on query call and deserializes before query execution", () => {
    const zt = createZeroDataTransformer({ argsTransformer: transformer });
    let received: Date | undefined;

    const defs = {
      issue: {
        byCreatedAt: zt.defineQuery(
          makeValidator<Date, Date>((value) => value),
          ({ args }) => {
            received = args;
            return builder.issue.where("id", "=", "issue-1");
          },
        ),
      },
    };

    const queries = zt.defineQueries(defs);
    const request = queries.issue.byCreatedAt(new Date("2025-01-02T03:04:05.000Z"));

    expect(request.args).toBe(
      JSON.stringify({
        type: "Date",
        value: "2025-01-02T03:04:05.000Z",
      }),
    );

    request.query.fn({ args: request.args, ctx: undefined });

    expect(received).toEqual(new Date("2025-01-02T03:04:05.000Z"));
  });

  test("supports mixed wrapped and unwrapped definitions plus base overrides", async () => {
    const zt = createZeroDataTransformer({ argsTransformer: transformer });
    let transformedReceived: Date | undefined;
    let plainMutatorReceived: string | undefined;
    let overrideReceived: Date | undefined;
    let plainQueryReceived: string | undefined;

    const baseMutatorDefs = {
      issue: {
        schedule: zt.defineMutator(
          makeValidator<Date, Date>((value) => value),
          async ({ args }) => {
            transformedReceived = args;
          },
        ),
        rename: defineCoreMutator(async ({ args }: { args: string; ctx: undefined }) => {
          plainMutatorReceived = args;
        }),
      },
    };

    const overrideMutatorDefs = {
      issue: {
        reschedule: zt.defineMutator(
          makeValidator<Date, Date>((value) => value),
          async ({ args }) => {
            overrideReceived = args;
          },
        ),
      },
    };

    const mutators = zt.defineMutators(baseMutatorDefs, overrideMutatorDefs);

    const transformedRequest = mutators.issue.schedule(new Date("2025-02-03T04:05:06.000Z"));
    const plainRequest = mutators.issue.rename("retitle");
    const overrideRequest = mutators.issue.reschedule(new Date("2025-06-07T08:09:10.000Z"));

    expect(transformedRequest.args).toBe(
      JSON.stringify({
        type: "Date",
        value: "2025-02-03T04:05:06.000Z",
      }),
    );
    expect(plainRequest.args).toBe("retitle");
    expect(overrideRequest.args).toBe(
      JSON.stringify({
        type: "Date",
        value: "2025-06-07T08:09:10.000Z",
      }),
    );

    await transformedRequest.mutator.fn({
      args: transformedRequest.args,
      ctx: undefined,
      tx: {} as never,
    });
    await plainRequest.mutator.fn({
      args: plainRequest.args,
      ctx: undefined,
      tx: {} as never,
    });
    await overrideRequest.mutator.fn({
      args: overrideRequest.args,
      ctx: undefined,
      tx: {} as never,
    });

    expect(transformedReceived).toEqual(new Date("2025-02-03T04:05:06.000Z"));
    expect(plainMutatorReceived).toBe("retitle");
    expect(overrideReceived).toEqual(new Date("2025-06-07T08:09:10.000Z"));

    const baseQueryDefs = {
      issue: {
        byDate: zt.defineQuery(
          makeValidator<Date, Date>((value) => value),
          ({ args }) => {
            transformedReceived = args;
            return builder.issue.where("id", "=", "issue-1");
          },
        ),
        byTitle: defineCoreQuery(({ args }: { args: string; ctx: undefined }) => {
          plainQueryReceived = args;
          return builder.issue.where("title", "=", args);
        }),
      },
    };

    const overrideQueryDefs = {
      issue: {
        byOverrideDate: zt.defineQuery(
          makeValidator<Date, Date>((value) => value),
          ({ args }) => {
            overrideReceived = args;
            return builder.issue.where("id", "=", "issue-1");
          },
        ),
      },
    };

    const queries = zt.defineQueries(baseQueryDefs, overrideQueryDefs);

    const transformedQueryRequest = queries.issue.byDate(new Date("2025-02-03T04:05:06.000Z"));
    const plainQueryRequest = queries.issue.byTitle("hello");
    const overrideQueryRequest = queries.issue.byOverrideDate(new Date("2025-06-07T08:09:10.000Z"));

    expect(transformedQueryRequest.args).toBe(
      JSON.stringify({
        type: "Date",
        value: "2025-02-03T04:05:06.000Z",
      }),
    );
    expect(plainQueryRequest.args).toBe("hello");
    expect(overrideQueryRequest.args).toBe(
      JSON.stringify({
        type: "Date",
        value: "2025-06-07T08:09:10.000Z",
      }),
    );

    transformedQueryRequest.query.fn({
      args: transformedQueryRequest.args,
      ctx: undefined,
    });
    plainQueryRequest.query.fn({
      args: plainQueryRequest.args,
      ctx: undefined,
    });
    overrideQueryRequest.query.fn({
      args: overrideQueryRequest.args,
      ctx: undefined,
    });

    expect(transformedReceived).toEqual(new Date("2025-02-03T04:05:06.000Z"));
    expect(plainQueryReceived).toBe("hello");
    expect(overrideReceived).toEqual(new Date("2025-06-07T08:09:10.000Z"));
  });

  test("serializes on registry member mutator .fn direct calls", async () => {
    const zt = createZeroDataTransformer({ argsTransformer: transformer });
    let received: { id: string; when: Date } | undefined;

    const mutators = zt.defineMutators({
      issue: {
        schedule: zt.defineMutator(
          makeValidator<{ id: string; when: Date }, { id: string; when: Date }>((value) => value),
          async ({ args }) => {
            received = args;
          },
        ),
      },
    });

    await mutators.issue.schedule.fn({
      args: {
        id: "issue-1",
        when: new Date("2025-01-02T03:04:05.000Z"),
      },
      ctx: undefined,
      tx: {} as never,
    });

    expect(received).toEqual({
      id: "issue-1",
      when: new Date("2025-01-02T03:04:05.000Z"),
    });
  });

  test("serializes on registry member query .fn direct calls", () => {
    const zt = createZeroDataTransformer({ argsTransformer: transformer });
    let received: Date | undefined;

    const queries = zt.defineQueries({
      issue: {
        byCreatedAt: zt.defineQuery(
          makeValidator<Date, Date>((value) => value),
          ({ args }) => {
            received = args;
            return builder.issue.where("id", "=", "issue-1");
          },
        ),
      },
    });

    queries.issue.byCreatedAt.fn({
      args: new Date("2025-01-02T03:04:05.000Z"),
      ctx: undefined,
    });

    expect(received).toEqual(new Date("2025-01-02T03:04:05.000Z"));
  });

  test("wraps mutator tx with schema-based query and write transforms", async () => {
    const when = new Date("2025-01-02T03:04:05.000Z");
    const rawRun = vi.fn(async () => [
      {
        id: "issue-1",
        title: "First",
        createdAt: when.getTime(),
      },
    ]);
    const rawInsert = vi.fn(async () => {});

    const rawTx = {
      location: "client" as const,
      clientID: "client-1",
      mutationID: 1,
      reason: "optimistic" as const,
      mutate: {
        issue: {
          insert: rawInsert,
          upsert: vi.fn(async () => {}),
          update: vi.fn(async () => {}),
          delete: vi.fn(async () => {}),
        },
      },
      query: {
        issue: rawBuilder.issue,
      },
      run: rawRun,
    };

    const zt = createZeroDataTransformer({
      argsTransformer: transformer,
      schema,
    });

    let runResult: unknown;
    let queryResult: unknown;

    const defs = {
      issue: {
        schedule: zt.defineMutator(
          makeValidator<{ id: string; when: Date }, { id: string; when: Date }>((value) => value),
          async ({ args, tx }) => {
            await tx.mutate.issue!.insert({
              id: args.id,
              title: "scheduled",
              createdAt: args.when,
            });
            runResult = await tx.run(builder.issue.where("createdAt", args.when));
            queryResult = await (tx.query as any).issue.where("createdAt", args.when).run();
          },
        ),
      },
    };

    const mutators = zt.defineMutators(defs);
    const request = mutators.issue.schedule({ id: "issue-1", when });
    await request.mutator.fn({
      args: request.args,
      ctx: undefined,
      tx: rawTx as never,
    });

    expect(rawInsert).toHaveBeenCalledWith({
      id: "issue-1",
      title: "scheduled",
      createdAt: when.getTime(),
    });
    expect(rawRun).toHaveBeenCalledTimes(2);
    expect(
      asQueryInternals(((rawRun.mock.calls as unknown as [any][])[0] ?? [undefined])[0]).ast.where,
    ).toMatchObject({
      right: { type: "literal", value: when.getTime() },
    });
    expect(
      asQueryInternals(((rawRun.mock.calls as unknown as [any][])[1] ?? [undefined])[0]).ast.where,
    ).toMatchObject({
      right: { type: "literal", value: when.getTime() },
    });
    expect(runResult).toEqual([
      {
        id: "issue-1",
        title: "First",
        createdAt: when,
      },
    ]);
    expect(queryResult).toEqual(runResult);
  });
});

describe("devalue argsTransformer", () => {
  const devalueTransformer: ArgsTransformer = {
    serialize(value: unknown): string | undefined {
      return value === undefined ? undefined : devalueStringify(value);
    },
    deserialize(value): unknown {
      return value === undefined ? undefined : devalueParse(value as string);
    },
  };

  test("supports string-backed mutator args", async () => {
    const zt = createZeroDataTransformer({ argsTransformer: devalueTransformer });
    let received: { id: string; when: Date } | undefined;

    const mutators = zt.defineMutators({
      issue: {
        schedule: zt.defineMutator(
          makeValidator<{ id: string; when: Date }, { id: string; when: Date }>((value) => value),
          async ({ args }) => {
            received = args;
          },
        ),
      },
    });

    const args = {
      id: "issue-1",
      when: new Date("2025-01-02T03:04:05.000Z"),
    };
    const serializedArgs = devalueTransformer.serialize(args);

    expect(typeof serializedArgs).toBe("string");

    await mutators.issue.schedule.fn({
      args,
      ctx: undefined,
      tx: {} as never,
    });

    expect(received).toEqual({
      id: "issue-1",
      when: new Date("2025-01-02T03:04:05.000Z"),
    });
  });

  test("supports string-backed query args", () => {
    const zt = createZeroDataTransformer({ argsTransformer: devalueTransformer });
    let received: Date | undefined;

    const queries = zt.defineQueries({
      issue: {
        byCreatedAt: zt.defineQuery(
          makeValidator<Date, Date>((value) => value),
          ({ args }) => {
            received = args;
            return builder.issue.where("id", "=", "issue-1");
          },
        ),
      },
    });

    const args = new Date("2025-01-02T03:04:05.000Z");
    const serializedArgs = devalueTransformer.serialize(args);

    expect(typeof serializedArgs).toBe("string");

    queries.issue.byCreatedAt.fn({
      args,
      ctx: undefined,
    });

    expect(received).toEqual(new Date("2025-01-02T03:04:05.000Z"));
  });
});

describe("superjson argsTransformer", () => {
  const superjsonTransformer: ArgsTransformer = {
    serialize(value: unknown): ReadonlyJSONValue | undefined {
      return value === undefined
        ? undefined
        : (superjson.serialize(value) as unknown as ReadonlyJSONValue);
    },
    deserialize(value): unknown {
      return value === undefined ? undefined : superjson.deserialize(value as never);
    },
  };

  test("supports object-backed mutator args", async () => {
    const zt = createZeroDataTransformer({ argsTransformer: superjsonTransformer });
    let received: { id: string; when: Date } | undefined;

    const mutators = zt.defineMutators({
      issue: {
        schedule: zt.defineMutator(
          makeValidator<{ id: string; when: Date }, { id: string; when: Date }>((value) => value),
          async ({ args }) => {
            received = args;
          },
        ),
      },
    });

    const args = {
      id: "issue-1",
      when: new Date("2025-01-02T03:04:05.000Z"),
    };
    const serializedArgs = superjsonTransformer.serialize(args);

    expect(serializedArgs).toMatchObject({
      json: {
        id: "issue-1",
        when: "2025-01-02T03:04:05.000Z",
      },
    });

    await mutators.issue.schedule.fn({
      args,
      ctx: undefined,
      tx: {} as never,
    });

    expect(received).toEqual({
      id: "issue-1",
      when: new Date("2025-01-02T03:04:05.000Z"),
    });
  });

  test("supports object-backed query args", () => {
    const zt = createZeroDataTransformer({ argsTransformer: superjsonTransformer });
    let received: Date | undefined;

    const queries = zt.defineQueries({
      issue: {
        byCreatedAt: zt.defineQuery(
          makeValidator<Date, Date>((value) => value),
          ({ args }) => {
            received = args;
            return builder.issue.where("id", "=", "issue-1");
          },
        ),
      },
    });

    const args = new Date("2025-01-02T03:04:05.000Z");
    const serializedArgs = superjsonTransformer.serialize(args);

    expect(serializedArgs).toMatchObject({
      json: "2025-01-02T03:04:05.000Z",
    });

    queries.issue.byCreatedAt.fn({
      args,
      ctx: undefined,
    });

    expect(received).toEqual(new Date("2025-01-02T03:04:05.000Z"));
  });
});
