# Zero Data Transformer

`zero-data-transformer` is a proof-of-concept for layering custom data types on top of `@rocicorp/zero`. The design is directly inspired by both [tRPC's Data Transformers](https://trpc.io/docs/server/data-transformers) and [Drizzle's Custom Types](https://orm.drizzle.team/docs/custom-types).

A fork of `zbugs` in this repo has been ported to use `zero-data-transformer`, with `Temporal.Instant` used for the runtime values of timestamp columns and query/mutator args.

## Status

`zero-data-transformer` is a proof of concept, do not use it in production.

## Overview

`zero-data-transformer` works by providing thin wrappers around `@rocicorp/zero` APIs to transform values at the edges. These wrapper functions are created with `createZeroDataTransformer(...)`, and the exact set you need to use depends on which of the features you opt into. All features can be used together. More details can be found below.

### Query and Mutator Args

Use arbitrary runtime values as query and mutator args without worrying about whether they are JSON-compatible by providing custom serialization. You enable this by passing `argsTransformer` to `createZeroDataTransformer(...)`.

For example, with `superjson`:

```ts
import superjson from 'superjson';
import {createZeroDataTransformer} from 'zero-data-transformer';

const zdt = createZeroDataTransformer({
  argsTransformer: {
    serialize(value) {
      return superjson.serialize(value);
    },
    deserialize(value) {
      return superjson.deserialize(value);
    },
  },
});
```

Or with `devalue`:

```ts
import {parse, stringify} from 'devalue';
import {createZeroDataTransformer} from 'zero-data-transformer';

const zdt = createZeroDataTransformer({
  argsTransformer: {
    serialize(value) {
      return stringify(value);
    },
    deserialize(value) {
      return typeof value === 'string' ? parse(value) : value;
    },
  },
});
```

Then, you can define queries and mutators whose args include `Temporal.Instant` values:

```ts
import {z} from 'zod';
import {defineMutator, defineQueries, defineQuery} from './zdt';
import {builder} from './schema';

const recentIssuesArgsSchema = z.object({
  since: z.instanceof(Temporal.Instant),
});

export const queries = defineQueries({
  issue: {
    recent: defineQuery(recentIssuesArgsSchema, ({args}) =>
      builder.issue.where('createdAt', '>', args.since),
    ),
  },
});

const createIssueArgsSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.instanceof(Temporal.Instant),
  updatedAt: z.instanceof(Temporal.Instant),
});

export const mutators = {
  issue: {
    create: defineMutator(createIssueArgsSchema, async ({tx, args}) => {
      await tx.mutate.issue.insert({
        id: args.id,
        title: args.title,
        // These timestamp columns also use the custom column type shown below.
        createdAt: args.createdAt,
        updatedAt: args.updatedAt,
      });
    }),
  },
};
```

And then call them with `Temporal.Instant` values directly:

```ts
const since = Temporal.Now.instant().subtract({days: 7});

const issues = await zero.run(queries.issue.recent({since}));

await zero.mutate.issue.create({
  id: crypto.randomUUID(),
  title: 'Ship zero-data-transformer docs',
  createdAt: Temporal.Now.instant(),
  updatedAt: Temporal.Now.instant(),
});
```

To use this feature, use these wrappers from `createZeroDataTransformer(...)` for defining queries and mutators and handling query/mutator requests:

- `defineMutator(...)`
- `defineMutators(...)`
- `defineQuery(...)`
- `defineQueries(...)`
- `handleMutateRequest(...)`
- `handleQueryRequest(...)`

Additionally, use `mustGetMutator` and `mustGetQuery` from `zero-data-transformer` instead of `@rocicorp/zero`.

> [!NOTE]
> `superjson.serialize(...)` preserves object structure in a JSON-compatible value.
> `devalue` only exposes `stringify(...)` and `parse(...)`, so the serialized args become a string.
> That string-based approach seems to work, but the implications of that difference have not been fully explored.

### Custom Column Types

Custom column types allow you to use any type for a Zero schema column in your app code while storing the data with one of the supported Zero types. This is accomplished by providing `encode` and `decode` functions. Below is an example of a custom column type using `Temporal.Instant` (note: timestamps are stored as numbers in Zero).

```ts
import {customColumnType} from 'zero-data-transformer';

export const temporalInstantColumnBuilder = customColumnType({
  base: 'number', // must be one of: 'string' | 'number' | 'boolean' | 'json'
  encode(value: Temporal.Instant) {
    return value.epochMilliseconds;
  },
  decode(value: number) {
    return Temporal.Instant.fromEpochMilliseconds(value);
  },
});
```

Then, use the custom column type builder in your schema:

```ts
import {createSchema, string, table} from '@rocicorp/zero';

const issue = table('issue')
  .columns({
    id: string(),
    title: string(),
    createdAt: temporalInstantColumnBuilder(),
    updatedAt: temporalInstantColumnBuilder(),
  })
  .primaryKey('id');

const schema = createSchema({
  tables: [issue],
  relationships: [],
});
```

Finally, pass your schema into `createZeroDataTransformer(...)`:

```ts
const zdt = createZeroDataTransformer({schema});
```

After that, query filters, query results, and transaction writes can all use `Temporal.Instant` directly:

```ts
const now = Temporal.Now.instant();

const recentIssues = await zero.query.issue.where('createdAt', '>', now).run();

for (const issue of recentIssues) {
  issue.createdAt.toString();
  Temporal.Instant.compare(issue.updatedAt, now);
}

await tx.mutate.issue.insert({
  id: crypto.randomUUID(),
  title: 'New issue',
  createdAt: now,
  updatedAt: now,
});
```

> Query filters (e.g. `zql.issue.where(...)`) on custom column types are called with values of the custom column type but evaluated with the underlying Zero-supported column type. In our example with `Temporal.Instant` stored as epoch milliseconds, this is exactly what you'd want, but it is worth considering if this is the case for your custom column types.

To use this feature, use these wrappers from `createZeroDataTransformer(...)` for defining mutators and handling query/mutator requests:

- `createZero(...)` (rather than `new Zero(...)`)
- `createQueryBuilder(...)`
- `defineMutator(...)`
- `defineMutators(...)`

Additionally, if you create a Zero server transaction outside of mutators, you can wrap these with `wrapTransaction(...)` to apply the data transformations.

#### React Integration

To use custom column types in React, first use `createZero(...)` to create a `Zero` and pass that to `ZeroProvider`:

```tsx
import {ZeroProvider} from 'zero-data-transformer/react';
import {createZero} from './zdt';
import {queries} from './queries';
import {mutators} from './mutators';

const zero = createZero({
  queries,
  mutators,
  // Other ZeroOptions...
});

export function App({children}: {children: ReactNode}) {
  return <ZeroProvider zero={zero}>{children}</ZeroProvider>;
}
```

> [!NOTE]
> If you pass a `Zero` instance directly to `ZeroProvider`, `init()` is not called for you.
> Make sure you handle initialization alongside `createZero(...)` if you switch from passing `ZeroOptions` as `ZeroProvider` props.

Then use `useQuery(...)` or `useSuspenseQuery(...)` from `zero-data-transformer/react` so query results are decoded back into your custom column types in React components.

```tsx
import {useQuery, useZero} from 'zero-data-transformer/react';
import {queries} from './queries';

function RecentIssues() {
  const zero = useZero();
  const since = Temporal.Now.instant().subtract({days: 7});
  const [issues] = useQuery(queries.issue.recent({since}));

  return (
    <div>
      <button
        onClick={() =>
          zero.mutate.issue.create({
            id: crypto.randomUUID(),
            title: 'Created from React',
            createdAt: Temporal.Now.instant(),
            updatedAt: Temporal.Now.instant(),
          })
        }>
        Add issue
      </button>
      <ul>
        {issues.map(issue => (
          <li key={issue.id}>
            {issue.title} created at {issue.createdAt.toString()}
          </li>
        ))}
      </ul>
    </div>
  );
}
```
