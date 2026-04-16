import 'temporal-polyfill/global';
import {customColumnType} from 'zero-data-transformer';
import {z} from 'zod/mini';

export const temporalInstantSchema = z.instanceof(Temporal.Instant);

export const temporalInstantColumn = customColumnType({
  base: 'number',
  encode(value: Temporal.Instant) {
    return value.epochMilliseconds;
  },
  decode(value: number) {
    return Temporal.Instant.fromEpochMilliseconds(value);
  },
});
